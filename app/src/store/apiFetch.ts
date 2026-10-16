// The one place every request to gramps-web-api goes through. Call sites
// use apiFetch() exactly like fetch() -- same arguments, same Response --
// so anything that should apply to *all* API traffic (a concurrency cap,
// 429 retries today; logging, headers, or auth handling later) is added
// here once instead of at ~100 call sites. Use plain fetch() only for
// non-API URLs (Wikidata, the GitHub Gramplet catalog, static /lang/ and
// /pyodide/ files, blob: URLs).
//
// What it does today:
//
// - Caps requests in flight per lane; the rest wait in that lane's FIFO
//   queue. Without this, a burst (or a runaway loop) could open hundreds
//   of requests at once, which Chrome rejects outright with
//   net::ERR_INSUFFICIENT_RESOURCES and which piles up behind gunicorn's
//   few workers on the server. A slot frees as soon as response headers
//   arrive, not when the body finishes -- so a plain file download holds
//   one only briefly.
//
//   Two lanes, chosen explicitly at the call site: "normal" (the default,
//   6 at once) and "long" (2 at once), passed as apiFetch(url, init,
//   { lane: "long" }). "long" is for requests the server works on before
//   it replies at all -- uploads, synchronous report/export generation --
//   so a few of those can't leave a click in the UI waiting behind them,
//   while a many-file upload still can't open unbounded requests.
//
// - Retries 429 Too Many Requests (deploy/ratelimit.caddy's per-client
//   limits, or gramps-web-api's own Flask-Limiter on login endpoints) up
//   to MAX_RETRIES times, waiting for the response's Retry-After plus a
//   little jitter. Safe for writes too: a 429 is always refused before any
//   handler runs, so nothing is applied twice. The wait doesn't hold a
//   slot. After the last retry the 429 is returned to the caller as-is.
//
// Every request's body must be replayable for the retry, which holds for
// the string/FormData/Blob/URLSearchParams bodies used throughout; a
// ReadableStream body would not be (none exist today).
//
// Works in the Gramplet worker too (no window/DOM use); each context gets
// its own queue. API images loaded by URL rather than fetched (<img src>,
// SVG <image>) get the matching retry from apiImage.ts.

export type ApiLane = "normal" | "long";
export interface ApiFetchOptions {
  /** See the header comment; defaults to "normal". */
  lane?: ApiLane;
}

export const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 30_000;
const FALLBACK_RETRY_MS = [1000, 2000, 4000];

interface Lane {
  max: number;
  inFlight: number;
  waiting: Array<() => void>;
}

const lanes: Record<ApiLane, Lane> = {
  normal: { max: 6, inFlight: 0, waiting: [] },
  long: { max: 2, inFlight: 0, waiting: [] },
};

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/** Resolves once a slot is free (FIFO), or rejects if `signal` aborts
 * first -- in which case the request never takes a slot at all. */
function acquireSlot(lane: Lane, signal: AbortSignal | null | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (lane.inFlight < lane.max) {
    lane.inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const grant = () => {
      signal?.removeEventListener("abort", onAbort);
      lane.inFlight++;
      resolve();
    };
    const onAbort = () => {
      const i = lane.waiting.indexOf(grant);
      if (i >= 0) lane.waiting.splice(i, 1);
      reject(abortError(signal!));
    };
    lane.waiting.push(grant);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function releaseSlot(lane: Lane): void {
  lane.inFlight--;
  lane.waiting.shift()?.();
}

function sleep(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Retry-After as either delta-seconds or an HTTP-date, plus 0-20% jitter
 * so a queue of requests limited together doesn't retry in lockstep. */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  let ms = FALLBACK_RETRY_MS[Math.min(attempt, FALLBACK_RETRY_MS.length - 1)];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      ms = seconds * 1000;
    } else {
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) ms = date - now;
    }
  }
  ms = Math.min(Math.max(ms, 0), MAX_RETRY_WAIT_MS);
  return ms * (1 + Math.random() * 0.2);
}

export async function apiFetch(input: string | URL, init?: RequestInit, options?: ApiFetchOptions): Promise<Response> {
  const signal = init?.signal;
  const lane = lanes[options?.lane ?? "normal"];
  for (let attempt = 0; ; attempt++) {
    await acquireSlot(lane, signal);
    let res: Response;
    try {
      res = await fetch(input, init);
    } finally {
      releaseSlot(lane);
    }
    if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
    const wait = retryDelayMs(res.headers.get("Retry-After"), attempt);
    const method = init?.method ?? "GET";
    const path = String(input).replace(/[?#].*$/, "");
    console.warn(`[apiFetch] 429, retry ${attempt + 1}/${MAX_RETRIES} in ${(wait / 1000).toFixed(1)}s: ${method} ${path}`);
    await sleep(wait, signal);
  }
}

/** Test-only: a lane's current queue depth. */
export function _apiFetchState(lane: ApiLane = "normal"): { inFlight: number; waiting: number } {
  return { inFlight: lanes[lane].inFlight, waiting: lanes[lane].waiting.length };
}
