// Session/token handling -- refresh-token rotation, close enough to
// gramps-web's Auth class (~/gramps/gramps-web/src/api.js: refresh dedup,
// expiry tolerance, 429 retry) to fix real-world expiry. Access tokens are
// short-lived (15 min, see gramps-web-api's JWT_ACCESS_TOKEN_EXPIRES) and
// refresh tokens are long-lived, so getToken() proactively refreshes ahead
// of expiry rather than waiting for a 401.
import { login as apiLogin, refreshAccessToken as apiRefreshAccessToken } from "../store/api";
import { API_BASE } from "../config";

const STORAGE_KEY = "gramps-connect.token";
const REFRESH_STORAGE_KEY = "gramps-connect.refreshToken";
const USERNAME_STORAGE_KEY = "gramps-connect.username";

// Refresh a little before the server would actually reject the token, so a
// request that starts just under the wire doesn't lose the race. Matches
// gramps-web's Auth._shouldRefresh tolerance.
const EXPIRY_TOLERANCE_MS = 60 * 1000;

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage unavailable (private browsing etc.) -- the token
    // still works for this session, it just won't survive a reload.
  }
}

let cachedToken: string | null = readStored(STORAGE_KEY);
let cachedRefreshToken: string | null = readStored(REFRESH_STORAGE_KEY);
let cachedUsername: string | null = readStored(USERNAME_STORAGE_KEY);
// Concurrent callers (runQuery's foreground fetch + background fill,
// several views polling at once) share one in-flight refresh instead of
// each racing the server with their own.
let refreshing: Promise<string> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore snapshot: is there a session token right now? */
export function getAuthSnapshot(): boolean {
  return cachedToken !== null;
}

export async function login(username: string, password: string): Promise<void> {
  const { accessToken, refreshToken } = await apiLogin(username, password);
  cachedToken = accessToken;
  cachedRefreshToken = refreshToken;
  cachedUsername = username;
  writeStored(STORAGE_KEY, accessToken);
  writeStored(REFRESH_STORAGE_KEY, refreshToken);
  writeStored(USERNAME_STORAGE_KEY, username);
  emit();
}

export function logout(): void {
  cachedToken = null;
  cachedRefreshToken = null;
  cachedUsername = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(REFRESH_STORAGE_KEY);
    sessionStorage.removeItem(USERNAME_STORAGE_KEY);
  } catch {
    // nothing to clear
  }
  emit();
}

/** The username entered at login, for comparing against a live-sync
 * notification's `changedBy` (see historyPoll.ts) to tell "I made this
 * change" from "someone else did". Not derived from the JWT: the token's
 * `sub` claim is the user's id (gramps-web-api's token.py:91 does
 * `identity=str(user_id)`), not their username, and carries no username
 * claim to fall back on either -- the server only resolves id -> username
 * when building the history response (history.py's get_user_dict()). */
export function getCurrentUsername(): string | null {
  return cachedUsername;
}

/** Keeps the cached username in sync after a self-service rename
 * (ProfileDialog.tsx's `name_new`) -- nothing else re-derives it from the
 * server, and ReloginDialog/history-poll comparisons both read it back via
 * getCurrentUsername(). */
export function setCurrentUsername(username: string): void {
  cachedUsername = username;
  writeStored(USERNAME_STORAGE_KEY, username);
}

/** The tree this session's token is scoped to (gramps-web-api's token.py
 * sets a `tree` claim only in multi-tree mode -- see get_tokens there), or
 * null in the single-tree case. Used by the cache-staleness check
 * (store/cacheMeta.ts) to tell one tree's cached rows from another's;
 * that check pairs it with the served database's own name/id, precisely
 * because this is null on a single-tree server. */
export function getTreeId(): string | null {
  if (!cachedToken) return null;
  const tree = decodeClaims(cachedToken)?.tree;
  return typeof tree === "string" ? tree : null;
}

/** Base64url without padding, the encoding gramps-api-client's
 * parse_api_key() expects for the URL half of a key. TextEncoder first so a
 * non-ASCII host doesn't throw out of btoa(). */
function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A GRAMPS_WEB_API_KEY value for this session, or null when not logged in.
 *
 * Not a server-issued credential: gramps-web-api has no user-facing API key
 * of its own (its persistent access tokens, POST /users/-/access-tokens/,
 * are hardcoded to the anniversaries_ics scope and no endpoint consumes one
 * yet). The key is a client-side composition -- `<refresh token>*<base64url
 * of the API URL>` -- of exactly what gramps-api-client's mint_api_key()
 * builds after its own username/password login, so pasting this into
 * GRAMPS_WEB_API_KEY makes Client.from_env() work without a second login.
 *
 * That means the key IS this session's refresh token, which is
 * password-equivalent: gramps-web-api's JWT_REFRESH_TOKEN_EXPIRES is False,
 * nothing revokes it (no JWT blocklist is configured), and signing out only
 * clears it locally. Changing the account password is the only way to
 * retire a copy, so the UI offering this must say so. */
export function getApiKey(): string | null {
  if (!cachedRefreshToken) return null;
  // gramps-api-client needs an absolute URL, and API_BASE is empty for a
  // same-origin deployment -- resolve against the current page either way.
  // The `/api` suffix matches what the client appends to a bare host itself.
  const url = new URL(`${API_BASE}/api`, window.location.href).href;
  return `${cachedRefreshToken}*${base64url(url)}`;
}

/** Decodes a JWT's claims payload without pulling in a jwt-decode
 * dependency for the couple of fields this module reads. Returns null for
 * anything unparseable so callers treat it the same as "no claims info". */
function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function decodeExpMs(token: string): number | null {
  const claims = decodeClaims(token);
  return typeof claims?.exp === "number" ? claims.exp * 1000 : null;
}

/** Checks the current access token's `permissions` claim (gramps-web-api's
 * token.py sets this from the user's role, see PERMISSIONS in auth/const.py)
 * for every permission name given -- true only if all are present. Reads
 * `cachedToken` directly rather than going through getToken(): this is used
 * to decide whether to *show* UI, not to make a request, so it doesn't need
 * to trigger a refresh -- false (hide the UI) is the right answer for "no
 * token yet" the same as for "token says no". */
export function hasPermissions(...perms: string[]): boolean {
  if (!cachedToken) return false;
  const claims = decodeClaims(cachedToken);
  const granted = claims?.permissions;
  if (!Array.isArray(granted)) return false;
  return perms.every((perm) => granted.includes(perm));
}

/** Whether the current access token is "fresh" -- minted directly by
 * login(), as opposed to reissued by the silent refresh in getToken()
 * (gramps-web-api's token.py sets `fresh=True` only on the former). Some
 * endpoints require this (`fresh_jwt_required`, e.g. deleting every object
 * in the tree) precisely so a stolen long-lived refresh token can't trigger
 * them -- callers should check this before attempting one, and re-collect
 * the password via login() if it's false. */
export function isTokenFresh(): boolean {
  if (!cachedToken) return false;
  return decodeClaims(cachedToken)?.fresh === true;
}

function isExpiringSoon(token: string): boolean {
  const expMs = decodeExpMs(token);
  return expMs === null || expMs < Date.now() + EXPIRY_TOLERANCE_MS;
}

async function refreshAccessToken(): Promise<string> {
  if (!cachedRefreshToken) {
    logout();
    throw new Error("not logged in");
  }
  try {
    const accessToken = await apiRefreshAccessToken(cachedRefreshToken);
    cachedToken = accessToken;
    writeStored(STORAGE_KEY, accessToken);
    return accessToken;
  } catch (err) {
    // The refresh token itself is invalid, expired, or revoked -- no way
    // forward but a fresh login.
    logout();
    throw err;
  }
}

/** Returns the current session token, transparently refreshing it first if
 * it's expired or about to be. ViewStore only ever calls this after
 * App.tsx has gated the UI behind a successful login, so throwing here is a
 * loud "this shouldn't happen" rather than a silent undefined. */
export async function getToken(): Promise<string> {
  if (!cachedToken) throw new Error("not logged in");
  if (!isExpiringSoon(cachedToken)) return cachedToken;

  if (!refreshing) {
    refreshing = refreshAccessToken().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}
