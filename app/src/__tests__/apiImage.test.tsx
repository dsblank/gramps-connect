// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let currentToken = "tok";
vi.mock("../auth/auth", () => ({ getToken: vi.fn(async () => currentToken) }));
// The first failure's HEAD check (imageIsMissing). Default: a status that
// isn't "missing", so the plain retry tests below see retries as before.
let headStatus = 503;
vi.mock("../store/apiFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../store/apiFetch")>()),
  apiFetch: vi.fn(async () => ({ status: headStatus }) as Response),
}));

import { apiFetch } from "../store/apiFetch";
import { imageIsMissing, retryApiImageOnError, useApiImageSrc, withRetryHint } from "../store/apiImage";

beforeEach(() => {
  currentToken = "tok";
  headStatus = 503;
  vi.mocked(apiFetch).mockClear();
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const URL_ = "/api/media/h1/thumbnail/100?jwt=tok&square=true";

/** The first onError checks whether the image exists (a HEAD) before
 * retrying; this lets that check settle so the retry's backoff timer is
 * scheduled. */
async function settleCheck() {
  await act(() => vi.advanceTimersByTimeAsync(0));
}

describe("withRetryHint", () => {
  it("leaves the first attempt untouched and sets checksum after", () => {
    expect(withRetryHint(URL_, 0)).toBe(URL_);
    expect(withRetryHint(URL_, 2)).toBe("/api/media/h1/thumbnail/100?jwt=tok&square=true&checksum=retry-2");
  });
});

describe("imageIsMissing", () => {
  it("is true only for statuses a retry can't fix", async () => {
    for (const [status, missing] of [[404, true], [403, true], [410, true], [429, false], [500, false], [401, false], [200, false]] as const) {
      headStatus = status;
      expect(await imageIsMissing(URL_)).toBe(missing);
    }
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toMatchObject({ method: "HEAD" });
  });

  it("is false when the request itself fails (offline)", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await imageIsMissing(URL_)).toBe(false);
  });
});

describe("useApiImageSrc", () => {
  it("gives up at once on a missing image -- one HEAD, no retries", async () => {
    headStatus = 404;
    const { result } = renderHook(() => useApiImageSrc(URL_));

    act(() => result.current.onError());
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(result.current).toMatchObject({ src: null, failed: true });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("still retries a rate-limited image", async () => {
    headStatus = 429;
    const { result } = renderHook(() => useApiImageSrc(URL_));

    act(() => result.current.onError());
    await settleCheck();
    await act(() => vi.advanceTimersByTimeAsync(1000));

    expect(result.current.src).toContain("checksum=retry-1");
    expect(result.current.failed).toBe(false);
  });

  it("retries with backoff, then reports failure", async () => {
    const { result } = renderHook(() => useApiImageSrc(URL_));
    expect(result.current.src).toBe(URL_);

    for (const [delay, attempt] of [[1000, 1], [2000, 2], [4000, 3]] as const) {
      act(() => result.current.onError());
      if (attempt === 1) await settleCheck();
      await act(() => vi.advanceTimersByTimeAsync(delay - 1));
      expect(result.current.src).not.toContain(`retry-${attempt}`);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(result.current.src).toContain(`checksum=retry-${attempt}`);
    }

    act(() => result.current.onError());
    expect(result.current).toMatchObject({ src: null, failed: true });
  });

  it("starts over for a new URL", async () => {
    const { result, rerender } = renderHook(({ url }) => useApiImageSrc(url), { initialProps: { url: URL_ } });
    act(() => result.current.onError());
    await settleCheck();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.src).toContain("retry-1");
    rerender({ url: "/api/media/h2/thumbnail/100?jwt=tok" });
    expect(result.current.src).toBe("/api/media/h2/thumbnail/100?jwt=tok");
  });

  it("retries with the session's current token", async () => {
    const { result } = renderHook(() => useApiImageSrc(URL_));
    currentToken = "newer";
    act(() => result.current.onError());
    await settleCheck();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.src).toBe("/api/media/h1/thumbnail/100?jwt=newer&square=true&checksum=retry-1");
  });
});

describe("retryApiImageOnError", () => {
  it("leaves a missing image alone after one HEAD", async () => {
    headStatus = 404;
    const image = document.createElement("img");
    image.setAttribute("src", URL_);
    document.body.appendChild(image);

    retryApiImageOnError(image);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(image.getAttribute("src")).toBe(URL_);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    image.remove();
  });

  it("re-sets an SVG image's href, up to 3 times", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", URL_);
    svg.appendChild(image);
    document.body.appendChild(svg);

    for (const [delay, attempt] of [[1000, 1], [2000, 2], [4000, 3]] as const) {
      retryApiImageOnError(image);
      await vi.advanceTimersByTimeAsync(delay);
      expect(image.getAttribute("href")).toContain(`checksum=retry-${attempt}`);
      expect(image.getAttribute("xlink:href")).toBeNull();
    }
    retryApiImageOnError(image);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(image.getAttribute("href")).toContain("retry-3");
    svg.remove();
  });

  it("retries with the session's current token", async () => {
    const image = document.createElement("img");
    image.setAttribute("src", URL_);
    document.body.appendChild(image);
    currentToken = "newer";
    retryApiImageOnError(image);
    await vi.advanceTimersByTimeAsync(1000);
    expect(image.getAttribute("src")).toBe("/api/media/h1/thumbnail/100?jwt=newer&square=true&checksum=retry-1");
    image.remove();
  });
});
