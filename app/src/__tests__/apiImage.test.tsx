// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryApiImageOnError, useApiImageSrc, withRetryHint } from "../store/apiImage";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const URL_ = "/api/media/h1/thumbnail/100?jwt=tok&square=true";

describe("withRetryHint", () => {
  it("leaves the first attempt untouched and sets checksum after", () => {
    expect(withRetryHint(URL_, 0)).toBe(URL_);
    expect(withRetryHint(URL_, 2)).toBe("/api/media/h1/thumbnail/100?jwt=tok&square=true&checksum=retry-2");
  });
});

describe("useApiImageSrc", () => {
  it("retries with backoff, then reports failure", async () => {
    const { result } = renderHook(() => useApiImageSrc(URL_));
    expect(result.current.src).toBe(URL_);

    for (const [delay, attempt] of [[1000, 1], [2000, 2], [4000, 3]] as const) {
      act(() => result.current.onError());
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
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.src).toContain("retry-1");
    rerender({ url: "/api/media/h2/thumbnail/100?jwt=tok" });
    expect(result.current.src).toBe("/api/media/h2/thumbnail/100?jwt=tok");
  });
});

describe("retryApiImageOnError", () => {
  it("re-sets an SVG image's href, up to 3 times", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", URL_);
    svg.appendChild(image);
    document.body.appendChild(svg);

    for (const [delay, attempt] of [[1000, 1], [2000, 2], [4000, 3]] as const) {
      retryApiImageOnError(image);
      vi.advanceTimersByTime(delay);
      expect(image.getAttribute("href")).toContain(`checksum=retry-${attempt}`);
      expect(image.getAttribute("xlink:href")).toBeNull();
    }
    retryApiImageOnError(image);
    vi.advanceTimersByTime(10_000);
    expect(image.getAttribute("href")).toContain("retry-3");
    svg.remove();
  });
});
