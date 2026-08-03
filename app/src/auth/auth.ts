// Session/token handling -- replaces the Layer 2/3 spike's hardcoded
// USERNAME/PASSWORD constants with a real (if minimal) login form. No
// refresh-token rotation or expiry countdown yet: gramps-web's Auth class
// (~/gramps/gramps-web/src/api.js -- refresh dedup, expiry tolerance, 429
// retry) is the reference to build against whenever full auth becomes its
// own milestone; this is deliberately simpler for now.
import { login as apiLogin } from "../store/api";

const STORAGE_KEY = "gramps-connect.token";

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let cachedToken: string | null = readStoredToken();
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
  const token = await apiLogin(username, password);
  cachedToken = token;
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // sessionStorage unavailable (private browsing etc.) -- the token
    // still works for this session, it just won't survive a reload.
  }
  emit();
}

export function logout(): void {
  cachedToken = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
  emit();
}

/** Returns the current session token. ViewStore only ever calls this after
 * App.tsx has gated the UI behind a successful login, so throwing here is a
 * loud "this shouldn't happen" rather than a silent undefined. */
export async function getToken(): Promise<string> {
  if (!cachedToken) throw new Error("not logged in");
  return cachedToken;
}
