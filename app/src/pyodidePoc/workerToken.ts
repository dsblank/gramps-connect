// The main-thread half of pyodideWorker.ts's token requests (see
// `need-token` in types.ts): every Gramplet worker owner -- the window,
// the View Gramplet panel and the editor -- answers them the same way, so
// the worker always gets whatever auth.ts's getToken() would hand any
// other request right now.
import { getToken, refreshTokenNow } from "../auth/auth";
import type { PyodideWorkerResponse } from "./types";

/** Answers `data` if it's a `need-token` message and returns true;
 * returns false (and does nothing) for anything else -- a type predicate,
 * so a caller's `if (answerTokenRequest(...)) return;` narrows `data` to
 * the output-carrying messages after it. */
export function answerTokenRequest(
  worker: Worker,
  data: PyodideWorkerResponse
): data is Extract<PyodideWorkerResponse, { type: "need-token" }> {
  if (data.type !== "need-token") return false;
  const { requestId } = data;
  (data.force ? refreshTokenNow() : getToken()).then(
    (token) => worker.postMessage({ type: "token-result", requestId, ok: true, token }),
    (err: unknown) =>
      worker.postMessage({
        type: "token-result",
        requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
  );
  return true;
}
