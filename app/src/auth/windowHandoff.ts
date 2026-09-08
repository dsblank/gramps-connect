// Carries a logged-in session into a window this tab opens for itself
// ("Open another window", UserMenu.tsx) without ever putting the refresh
// token in a URL: window.open() navigates the new tab to a bare #/home
// first, then the two windows exchange the token directly via postMessage,
// checked against this exact opener/child pair and this exact origin at
// every step -- see auth.ts's loginWithRefreshToken for the receiving
// side's bookkeeping. sessionStorage is per-tab by design (see auth.ts),
// so a plain link would otherwise re-prompt for credentials.
import { formatHash, HOME_KEY } from "../hash";
import { getRefreshToken, loginWithRefreshToken } from "./auth";

const READY = "gramps-connect:handoff-ready";
const TOKEN = "gramps-connect:handoff-token";
// Generous but bounded: long enough for a slow load, short enough that a
// listener from an abandoned attempt (popup blocked, tab closed before
// finishing) doesn't linger indefinitely.
const TIMEOUT_MS = 10000;

/** UserMenu.tsx's "Open another window" onClick. */
export function openHandoffWindow(): void {
  const refreshToken = getRefreshToken();
  const opened = window.open(formatHash({ viewKey: HOME_KEY }), "_blank");
  // Popup blocked, or (shouldn't happen -- the menu item that calls this is
  // only rendered while logged in) no session to hand off: the new tab (if
  // any) still opens and just shows its own LoginForm.
  if (!opened || !refreshToken) return;
  // Narrowed to a non-null binding TS retains across the closures below --
  // `opened` itself doesn't narrow inside a hoisted function declaration.
  const child: Window = opened;

  const origin = window.location.origin;
  let timer: ReturnType<typeof setTimeout>;

  function onMessage(event: MessageEvent) {
    // Both checks matter: origin alone would accept a message forged by any
    // same-origin script running in some other tab; source alone says
    // nothing about origin. Together they mean "this exact window, still at
    // this exact origin" -- the specific child window.open() returned.
    if (event.origin !== origin || event.source !== child) return;
    if ((event.data as { type?: string } | null)?.type !== READY) return;
    child.postMessage({ type: TOKEN, refreshToken }, origin);
    cleanup();
  }
  function cleanup() {
    window.removeEventListener("message", onMessage);
    clearTimeout(timer);
  }

  window.addEventListener("message", onMessage);
  timer = setTimeout(cleanup, TIMEOUT_MS);
}

/** App.tsx's synchronous first-render check: is this tab one that another
 * gramps-connect tab just window.open()'d (and so might be about to receive
 * a handoff)? Cheap and side-effect-free, so App.tsx can use it to hold a
 * brief loading state instead of flashing LoginForm before the handoff
 * below has a chance to land. */
export function isHandoffCandidate(): boolean {
  return window.opener !== null;
}

/** The receiving side: announces readiness to window.opener and waits (up
 * to TIMEOUT_MS) for the token reply, logging in via
 * auth.ts's loginWithRefreshToken on success. Always resolves, never
 * rejects -- a failed or timed-out handoff just leaves the tab logged out,
 * exactly as if it had been opened directly rather than via "Open another
 * window", so App.tsx doesn't need a separate error path. */
export function tryHandoffLogin(): Promise<void> {
  if (!isHandoffCandidate()) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const origin = window.location.origin;
    const opener = window.opener as Window;
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;

    function finish() {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve();
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== origin || event.source !== opener) return;
      const data = event.data as { type?: string; refreshToken?: string } | null;
      if (data?.type !== TOKEN || !data.refreshToken) return;
      loginWithRefreshToken(data.refreshToken)
        .catch((err) => console.error("window handoff login failed", err))
        .finally(finish);
    }

    window.addEventListener("message", onMessage);
    timer = setTimeout(finish, TIMEOUT_MS);
    opener.postMessage({ type: READY }, origin);
  });
}
