// apiFetch.ts's counterpart for API images shown straight from a URL
// (<img src>, an SVG <image href>) rather than fetched -- thumbnails and
// crops carrying their token as `?jwt=` (see mediaCrop.ts). The browser
// loads those itself, so apiFetch's 429 retry can't reach them; a load
// failure is retried here instead, up to MAX_RETRIES times with the same
// backoff, before the caller's own fallback (no image, initials) shows.
// Anything that should apply to every API image belongs here.
//
// A failed load isn't cached, but re-setting an identical URL doesn't
// reload it either, so each retry changes the `checksum` query param:
// gramps-web-api accepts it on every image route as a frontend
// cache-busting hint and leaves it out of its thumbnail cache key, so the
// retry still hits the server's cache. (Any other unknown param is a 422 --
// its query parser rejects unknown args.)
//
// An onError can't see the status code, so a genuinely missing image
// costs MAX_RETRIES extra requests over ~7s before its fallback shows.
import { useCallback, useEffect, useState } from "react";
import { MAX_RETRIES, retryDelayMs } from "./apiFetch";

export function withRetryHint(url: string, attempt: number): string {
  if (attempt === 0) return url;
  const u = new URL(url, location.href);
  u.searchParams.set("checksum", `retry-${attempt}`);
  return u.origin === location.origin ? u.pathname + u.search : u.href;
}

/** For a React <img>/Mantine Image/Avatar: pass `src` and `onError` through.
 * `failed` turns true once every retry has failed. */
export function useApiImageSrc(url: string | null): { src: string | null; onError: () => void; failed: boolean } {
  const [state, setState] = useState({ url, attempt: 0, failed: false, waiting: false });
  // A new URL starts over -- reset during render, not in an effect, so the
  // old URL's retry count never leaks onto the new one's first frame.
  const current = state.url === url ? state : { url, attempt: 0, failed: false, waiting: false };
  if (current !== state) setState(current);

  useEffect(() => {
    if (!state.waiting) return;
    const timer = setTimeout(
      () => setState((s) => (s.url === state.url ? { ...s, attempt: s.attempt + 1, waiting: false } : s)),
      retryDelayMs(null, state.attempt),
    );
    return () => clearTimeout(timer);
  }, [state.waiting, state.attempt, state.url]);

  const onError = useCallback(() => {
    setState((s) => {
      if (s.waiting || s.failed) return s;
      return s.attempt >= MAX_RETRIES ? { ...s, failed: true } : { ...s, waiting: true };
    });
  }, []);

  return {
    src: url && !current.failed ? withRetryHint(url, current.attempt) : null,
    onError,
    failed: current.failed,
  };
}

/** For an image element created outside React (a D3 chart's <image>):
 * attach as its "error" handler. Retries by re-setting href on the element
 * itself; after the last retry the element is left as-is (blank). */
export function retryApiImageOnError(el: SVGImageElement | HTMLImageElement): void {
  const attempt = Number(el.dataset.apiRetry ?? "0");
  if (attempt >= MAX_RETRIES) return;
  const isSvg = el.tagName.toLowerCase() === "image";
  const original = el.dataset.apiSrc ?? (isSvg ? (el.getAttribute("href") ?? el.getAttribute("xlink:href")) : el.getAttribute("src"));
  if (!original) return;
  el.dataset.apiSrc = original;
  el.dataset.apiRetry = String(attempt + 1);
  setTimeout(() => {
    if (!el.isConnected) return;
    const next = withRetryHint(original, attempt + 1);
    if (isSvg) {
      el.setAttribute("href", next);
      el.removeAttribute("xlink:href");
    } else {
      el.setAttribute("src", next);
    }
  }, retryDelayMs(null, attempt));
}
