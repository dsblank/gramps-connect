import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeysUnsupported, createApiKey, deleteApiKey, listApiKeys, parseServerUtc } from "../apiKeysApi";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("parseServerUtc", () => {
  it("reads a zone-less server timestamp as UTC", () => {
    expect(parseServerUtc("2026-10-04T16:28:54").toISOString()).toBe("2026-10-04T16:28:54.000Z");
    expect(parseServerUtc("2026-10-04T16:28:54.893145").toISOString()).toBe("2026-10-04T16:28:54.893Z");
  });

  it("keeps an explicit zone", () => {
    expect(parseServerUtc("2026-10-04T16:28:54+02:00").toISOString()).toBe("2026-10-04T14:28:54.000Z");
    expect(parseServerUtc("2026-10-04T16:28:54Z").toISOString()).toBe("2026-10-04T16:28:54.000Z");
  });
});

describe("apiKeysApi", () => {
  it("lists the sync-scope keys", async () => {
    const keys = [{ id: 1, label: "Laptop", created_at: "2026-10-04T16:28:54", last_used_at: null }];
    const fetchMock = stubFetch(200, keys);
    expect(await listApiKeys("tok")).toEqual(keys);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/users/-/access-tokens/sync/tokens/");
  });

  it("reports a server without API keys (404) as unsupported", async () => {
    stubFetch(404, { code: 404, status: "Not Found" });
    await expect(listApiKeys("tok")).rejects.toBeInstanceOf(ApiKeysUnsupported);
  });

  it("creates a key by label and surfaces the server's conflict message", async () => {
    const fetchMock = stubFetch(201, { id: 2, label: "Laptop", created_at: "x", last_used_at: null, token: "abc" });
    expect((await createApiKey("tok", "Laptop")).token).toBe("abc");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ label: "Laptop" });

    stubFetch(409, { error: { code: 409, message: "An access token with this label exists" } });
    await expect(createApiKey("tok", "Laptop")).rejects.toThrow("An access token with this label exists");
  });

  it("removes a key by id", async () => {
    const fetchMock = stubFetch(204, undefined);
    await deleteApiKey("tok", 7);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/sync\/tokens\/7\/$/);
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});
