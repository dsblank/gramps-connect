import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _apiFetchState, apiFetch, retryDelayMs, setTokenRenewer } from "../store/apiFetch";

/** A fetch stand-in whose responses the test releases by hand. */
function controllableFetch() {
  const pending: Array<{ url: string; init?: RequestInit; resolve: (r: Response) => void }> = [];
  const fn = vi.fn((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve) => pending.push({ url, init, resolve })),
  );
  return { fn, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("apiFetch", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps at most 6 requests in flight, FIFO", async () => {
    const { fn, pending } = controllableFetch();
    vi.stubGlobal("fetch", fn);
    const results = Array.from({ length: 10 }, (_, i) => apiFetch(`/api/x/${i}`));
    await flush();
    expect(fn).toHaveBeenCalledTimes(6);
    expect(_apiFetchState()).toEqual({ inFlight: 6, waiting: 4 });

    pending[0].resolve(new Response("ok"));
    await flush();
    expect(fn).toHaveBeenCalledTimes(7);
    expect(pending[6].url).toBe("/api/x/6");

    for (let i = 1; i < 10; i++) {
      pending[i].resolve(new Response("ok"));
      await flush();
    }
    await Promise.all(results);
    expect(_apiFetchState()).toEqual({ inFlight: 0, waiting: 0 });
  });

  it("runs long-lane requests 2 at a time, without blocking the normal lane", async () => {
    const { fn, pending } = controllableFetch();
    vi.stubGlobal("fetch", fn);
    const uploads = Array.from({ length: 4 }, (_, i) => apiFetch(`/api/upload/${i}`, { method: "POST" }, { lane: "long" }));
    await flush();
    expect(_apiFetchState("long")).toEqual({ inFlight: 2, waiting: 2 });

    // The normal lane still has all 6 slots while uploads are stuck.
    const normal = Array.from({ length: 6 }, (_, i) => apiFetch(`/api/x/${i}`));
    await flush();
    expect(_apiFetchState("normal")).toEqual({ inFlight: 6, waiting: 0 });
    expect(fn).toHaveBeenCalledTimes(8);

    // Finishing one upload starts the next queued upload, not a normal one.
    pending[0].resolve(new Response("ok"));
    await flush();
    expect(pending[8].url).toBe("/api/upload/2");

    pending.slice(1).forEach((p) => p.resolve(new Response("ok")));
    await flush();
    pending.slice(9).forEach((p) => p.resolve(new Response("ok")));
    await Promise.all([...uploads, ...normal]);
    expect(_apiFetchState("long")).toEqual({ inFlight: 0, waiting: 0 });
    expect(_apiFetchState("normal")).toEqual({ inFlight: 0, waiting: 0 });
  });

  it("frees the slot when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("network"))));
    await expect(apiFetch("/api/x")).rejects.toThrow("network");
    expect(_apiFetchState()).toEqual({ inFlight: 0, waiting: 0 });
  });

  it("drops a queued request whose signal aborts, without taking a slot", async () => {
    const { fn, pending } = controllableFetch();
    vi.stubGlobal("fetch", fn);
    const first = Array.from({ length: 6 }, (_, i) => apiFetch(`/api/x/${i}`));
    const controller = new AbortController();
    const queued = apiFetch("/api/queued", { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(_apiFetchState()).toEqual({ inFlight: 6, waiting: 0 });
    pending.forEach((p) => p.resolve(new Response("ok")));
    await Promise.all(first);
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it("retries a 429 after Retry-After, replaying the same body", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response("done"));
    vi.stubGlobal("fetch", fn);
    const init = { method: "POST", body: '{"a":1}' };
    const result = apiFetch("/api/notes/", init);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1]).toEqual(["/api/notes/", init]);
    expect(await (await result).text()).toBe("done");
  });

  it("returns the 429 after 3 retries", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(() => Promise.resolve(new Response("", { status: 429 })));
    vi.stubGlobal("fetch", fn);
    const result = apiFetch("/api/x");
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    expect((await result).status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("waits out a long Retry-After in full instead of retrying early", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "100" } }))
      .mockResolvedValueOnce(new Response("done"));
    vi.stubGlobal("fetch", fn);
    const result = apiFetch("/api/x");
    await vi.advanceTimersByTimeAsync(99_999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe(200);
  });

  it("returns a 429 at once when Retry-After is longer than 2 minutes", async () => {
    const fn = vi.fn(() => Promise.resolve(new Response("", { status: 429, headers: { "Retry-After": "600" } })));
    vi.stubGlobal("fetch", fn);
    expect((await apiFetch("/api/x")).status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops waiting to retry when aborted", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(() => Promise.resolve(new Response("", { status: 429, headers: { "Retry-After": "10" } })));
    vi.stubGlobal("fetch", fn);
    const controller = new AbortController();
    const result = apiFetch("/api/x", { signal: controller.signal });
    const settled = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await settled;
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("apiFetch 401 renewal", () => {
  afterEach(() => {
    setTokenRenewer(null);
    vi.unstubAllGlobals();
  });

  const authOf = (init?: RequestInit) => new Headers(init?.headers).get("Authorization");

  it("replays a rejected request once with the renewed token, keeping its other headers and body", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    const renewer = vi.fn(async () => "new");
    setTokenRenewer(renewer);
    const res = await apiFetch("/api/x", {
      method: "PUT", body: "data", headers: { Authorization: "Bearer old", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(renewer).toHaveBeenCalledWith("old");
    const [, init] = fetch.mock.calls[1];
    expect(authOf(init)).toBe("Bearer new");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(init).toMatchObject({ method: "PUT", body: "data" });
  });

  it("returns a second 401 rather than renewing again", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const renewer = vi.fn(async () => "new");
    setTokenRenewer(renewer);
    expect((await apiFetch("/api/x", { headers: { Authorization: "Bearer old" } })).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(renewer).toHaveBeenCalledTimes(1);
  });

  it("returns the 401 when there's no new token, or no Bearer token was sent", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    setTokenRenewer(async () => null);
    expect((await apiFetch("/api/x", { headers: { Authorization: "Bearer old" } })).status).toBe(401);
    const renewer = vi.fn(async () => "new");
    setTokenRenewer(renewer);
    expect((await apiFetch("/api/token/", { method: "POST" })).status).toBe(401);
    expect(renewer).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("retryDelayMs", () => {
  beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0));
  afterEach(() => vi.restoreAllMocks());

  it("reads delta-seconds", () => {
    expect(retryDelayMs("3", 0)).toBe(3000);
  });

  it("reads an HTTP-date", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(retryDelayMs("Fri, 16 Oct 2026 12:00:05 GMT", 0, now)).toBe(5000);
  });

  it("falls back to 1s/2s/4s backoff", () => {
    expect([0, 1, 2, 5].map((a) => retryDelayMs(null, a))).toEqual([1000, 2000, 4000, 4000]);
  });

  it("honours a Retry-After up to 2 minutes in full, plus up to 20% jitter", () => {
    expect(retryDelayMs("120", 0)).toBe(120_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(retryDelayMs("90", 0)).toBeCloseTo(99_000);
  });

  it("gives up on a Retry-After longer than 2 minutes", () => {
    expect(retryDelayMs("121", 0)).toBeNull();
    expect(retryDelayMs("3600", 0)).toBeNull();
  });
});
