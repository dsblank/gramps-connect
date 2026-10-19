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
//   to MAX_RETRIES times, waiting the full Retry-After plus a little
//   jitter -- never less, since an early retry is refused again for
//   certain. A Retry-After longer than MAX_RETRY_WAIT_MS (2 minutes, the
//   longest window in ratelimit.caddy) isn't waited out at all: the 429
//   goes straight back to the caller rather than hanging the request. Safe
//   for writes too: a 429 is always refused before any handler runs, so
//   nothing is applied twice. The wait doesn't hold a slot. After the last
//   retry the 429 is returned to the caller as-is.
//
// - Replays a request once after a 401 that rejected its Bearer token, with
//   the token setTokenRenewer()'s function (auth.ts) hands back -- for a
//   token that went stale on the way: picked up just before the computer
//   slept, or waiting in a queue or a 429 backoff past its expiry.
//   getToken() refreshes ahead of expiry, but only for requests that ask it
//   after the fact. Not registered in the Gramplet worker, which has its own
//   401 retry (pyodideWorker.ts).
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
const MAX_RETRY_WAIT_MS = 120_000;
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

/** 0-20% extra, so a queue of requests limited together doesn't retry in
 * lockstep. Only ever added -- never waits less than asked. */
function withJitter(ms: number): number {
  return ms * (1 + Math.random() * 0.2);
}

/** The 1s/2s/4s wait before retry number `attempt + 1` when the server
 * gave no Retry-After (and for apiImage.ts, which never sees one). */
export function backoffMs(attempt: number): number {
  return withJitter(FALLBACK_RETRY_MS[Math.min(attempt, FALLBACK_RETRY_MS.length - 1)]);
}

/** How long to wait before retrying a 429: its Retry-After (delta-seconds
 * or an HTTP-date) plus jitter, else backoffMs(). null when Retry-After
 * asks for longer than MAX_RETRY_WAIT_MS -- not worth retrying. */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number | null {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const date = Date.parse(retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : !Number.isNaN(date) ? date - now : null;
    if (ms !== null) return ms > MAX_RETRY_WAIT_MS ? null : withJitter(Math.max(ms, 0));
  }
  return backoffMs(attempt);
}

/** Given the access token a server just rejected, a token to replay the
 * request with -- or null to give up and return the 401. */
export type TokenRenewer = (rejected: string) => Promise<string | null>;

let renewToken: TokenRenewer | null = null;

/** auth.ts registers its renewer here at load; apiFetch.ts can't import
 * auth.ts itself (auth.ts's login requests go through apiFetch, and the
 * Gramplet worker uses apiFetch without auth.ts at all). */
export function setTokenRenewer(renewer: TokenRenewer | null): void {
  renewToken = renewer;
}

/** The token a "Bearer <token>" Authorization header carries, if any. */
function bearerToken(init: RequestInit | undefined): string | null {
  const header = new Headers(init?.headers).get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export async function apiFetch(input: string | URL, init?: RequestInit, options?: ApiFetchOptions): Promise<Response> {
  const signal = init?.signal;
  const lane = lanes[options?.lane ?? "normal"];
  let renewed = false;
  for (let attempt = 0; ; attempt++) {
    await acquireSlot(lane, signal);
    let res: Response;
    try {
      res = await fetch(input, init);
    } finally {
      releaseSlot(lane);
    }
    if (res.status === 401 && !renewed && renewToken) {
      renewed = true;
      const rejected = bearerToken(init);
      const token = rejected ? await renewToken(rejected) : null;
      if (token && token !== rejected) {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        init = { ...init, headers };
        attempt--; // not a 429 retry
        continue;
      }
    }
    if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
    const wait = retryDelayMs(res.headers.get("Retry-After"), attempt);
    const method = init?.method ?? "GET";
    const path = String(input).replace(/[?#].*$/, "");
    if (wait === null) {
      console.warn(`[apiFetch] 429, Retry-After too long to wait out: ${method} ${path}`);
      return res;
    }
    console.warn(`[apiFetch] 429, retry ${attempt + 1}/${MAX_RETRIES} in ${(wait / 1000).toFixed(1)}s: ${method} ${path}`);
    await sleep(wait, signal);
  }
}

/** Test-only: a lane's current queue depth. */
export function _apiFetchState(lane: ApiLane = "normal"): { inFlight: number; waiting: number } {
  return { inFlight: lanes[lane].inFlight, waiting: lanes[lane].waiting.length };
}
