// Session/token handling -- refresh-token rotation, close enough to
// gramps-web's Auth class (~/gramps/gramps-web/src/api.js: refresh dedup,
// expiry tolerance, 429 retry) to fix real-world expiry. Access tokens are
// short-lived (15 min, see gramps-web-api's JWT_ACCESS_TOKEN_EXPIRES) and
// refresh tokens are long-lived, so getToken() proactively refreshes ahead
// of expiry rather than waiting for a 401.
import { login as apiLogin, refreshAccessToken as apiRefreshAccessToken } from "../store/api";

const STORAGE_KEY = "gramps-connect.token";
const REFRESH_STORAGE_KEY = "gramps-connect.refreshToken";

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
  writeStored(STORAGE_KEY, accessToken);
  writeStored(REFRESH_STORAGE_KEY, refreshToken);
  emit();
}

export function logout(): void {
  cachedToken = null;
  cachedRefreshToken = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    // nothing to clear
  }
  emit();
}

/** Decodes a JWT's `exp` claim (seconds since epoch, per the spec) without
 * pulling in a jwt-decode dependency for one field. Returns null for
 * anything unparseable so callers treat it the same as "no expiry info". */
function decodeExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json);
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
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
