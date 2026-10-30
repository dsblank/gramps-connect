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
// A retry also swaps in the session's current token (withCurrentToken): a
// URL built before a refresh, or before the computer slept, carries one the
// server no longer takes.
//
// An onError can't see the status code, so the first failure asks the
// server once (imageIsMissing(), a HEAD through apiFetch) whether the image
// is there at all: a missing file (404) or a refused one (403, 400, ...)
// shows its fallback straight away instead of costing MAX_RETRIES extra
// requests over ~7s. Anything else -- 429, 5xx, an expired token, no
// network -- keeps the retries.
import { useCallback, useEffect, useState } from "react";
import { MAX_RETRIES, apiFetch, backoffMs } from "./apiFetch";
import { getToken } from "../auth/auth";

/** Statuses that retrying can't fix: the file isn't there (404, 410), or
 * the server won't serve it to this user or in this form. */
const PERMANENT_IMAGE_STATUSES = new Set([400, 403, 404, 410, 415, 422]);

/** Whether `url` (an image that just failed to load) is permanently
 * unavailable -- one HEAD request, so no image body comes back. apiFetch
 * itself waits out a 429 first. A request that fails outright (offline)
 * counts as "not missing": that's what the retries are for. */
export async function imageIsMissing(url: string): Promise<boolean> {
  try {
    const res = await apiFetch(url, { method: "HEAD" });
    return PERMANENT_IMAGE_STATUSES.has(res.status);
  } catch {
    return false;
  }
}

export function withRetryHint(url: string, attempt: number): string {
  if (attempt === 0) return url;
  const u = new URL(url, location.href);
  u.searchParams.set("checksum", `retry-${attempt}`);
  return u.origin === location.origin ? u.pathname + u.search : u.href;
}

/** For a React <img>/Mantine Image/Avatar: pass `src` and `onError` through.
 * `failed` turns true once every retry has failed. */
/** `url` with its `?jwt=` swapped for the session's current token
 * (getToken() refreshing it first if it's about to expire), or unchanged
 * when that's the one it already has. */
export async function withCurrentToken(url: string): Promise<string> {
  const u = new URL(url, location.href);
  const jwt = u.searchParams.get("jwt");
  if (!jwt) return url;
  let token: string;
  try {
    token = await getToken();
  } catch {
    return url;
  }
  if (token === jwt) return url;
  u.searchParams.set("jwt", token);
  return u.origin === location.origin ? u.pathname + u.search : u.href;
}

export function useApiImageSrc(url: string | null): { src: string | null; onError: () => void; failed: boolean } {
  // `retryUrl`: `url` with a current token, for the retries.
  const [state, setState] = useState({ url, retryUrl: url, attempt: 0, failed: false, waiting: false, checking: false });
  // A new URL starts over -- reset during render, not in an effect, so the
  // old URL's retry count never leaks onto the new one's first frame.
  const current = state.url === url ? state : { url, retryUrl: url, attempt: 0, failed: false, waiting: false, checking: false };
  if (current !== state) setState(current);

  useEffect(() => {
    if (!state.waiting) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void withCurrentToken(state.retryUrl ?? "").then((retryUrl) => {
        if (cancelled) return;
        setState((s) => (s.url === state.url ? { ...s, retryUrl, attempt: s.attempt + 1, waiting: false } : s));
      });
    }, backoffMs(state.attempt));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.waiting, state.attempt, state.url, state.retryUrl]);

  // The first failure checks whether the image exists at all before
  // retrying -- see this file's header.
  useEffect(() => {
    if (!state.checking || !state.url) return;
    let cancelled = false;
    void imageIsMissing(withRetryHint(state.retryUrl ?? state.url, state.attempt)).then((missing) => {
      if (cancelled) return;
      setState((s) => (s.url === state.url ? { ...s, checking: false, failed: missing, waiting: !missing } : s));
    });
    return () => {
      cancelled = true;
    };
  }, [state.checking, state.url, state.retryUrl, state.attempt]);

  const onError = useCallback(() => {
    setState((s) => {
      if (s.waiting || s.failed || s.checking) return s;
      if (s.attempt >= MAX_RETRIES) return { ...s, failed: true };
      return s.attempt === 0 ? { ...s, checking: true } : { ...s, waiting: true };
    });
  }, []);

  return {
    src: url && current.retryUrl && !current.failed ? withRetryHint(current.retryUrl, current.attempt) : null,
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
  el.dataset.apiRetry = String(attempt + 1);
  setTimeout(async () => {
    // First failure: a missing image stays blank now, with no retries.
    if (attempt === 0 && (await imageIsMissing(withRetryHint(original, 0)))) return;
    const fresh = await withCurrentToken(original);
    if (!el.isConnected) return;
    el.dataset.apiSrc = fresh;
    const next = withRetryHint(fresh, attempt + 1);
    if (isSvg) {
      el.setAttribute("href", next);
      el.removeAttribute("xlink:href");
    } else {
      el.setAttribute("src", next);
    }
  }, backoffMs(attempt));
}
