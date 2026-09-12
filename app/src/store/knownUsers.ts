// Every username this session has ever seen -- unlike activeUsers.ts's
// trailing 5-minute window, this never decays, so it can back a "who else
// is around" picker with everyone this browser has ever noticed, not just
// who's currently active. Fed for free off the same useLiveSync poll
// activeUsers.ts already piggybacks on (see useLiveSync.ts's
// recordKnownUser(notification.changedBy) call), plus -- for a role that
// can see it -- the real user list, same ViewOtherUser/ViewOtherTreeUser
// guard userDirectory.ts's loadUserDirectory() already uses.
import { getToken, hasPermissions } from "../auth/auth";
import { fetchAllUsers, ROLE_GUEST } from "./adminApi";

const known = new Set<string>();
// Usernames the directory load below confirmed are ROLE_GUEST -- guests
// can't be messaged (see auth.ts's isGuest() doc comment), so they're kept
// out of getKnownUsers()'s snapshot even though `known` still remembers
// them. Only ever populated from fetchAllUsers' role field: a username
// recorded via recordKnownUser() (a live-sync changedBy) carries no role,
// so it's never assumed to be a guest.
const guestUsers = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];
let directoryLoadPromise: Promise<void> | null = null;

function recomputeSnapshot(): void {
  snapshot = Array.from(known)
    .filter((name) => !guestUsers.has(name))
    .sort((a, b) => a.localeCompare(b));
}

/** True once the user directory has confirmed `username` is a Guest --
 * ParticipantsInput.tsx uses this to strip a guest's name back out even if
 * it's freely typed rather than picked from the suggestion list. */
export function isGuestUser(username: string): boolean {
  return guestUsers.has(username);
}

function notify(): void {
  recomputeSnapshot();
  for (const listener of listeners) listener();
}

/** Records `username` as known -- called from useLiveSync.ts for every
 * table's changedBy (not just Notes). */
export function recordKnownUser(username: string): void {
  if (known.has(username)) return;
  known.add(username);
  notify();
}

export function getKnownUsers(): string[] {
  return snapshot;
}

export function subscribeKnownUsers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Merges in the full user list when the signed-in role can see it --
 * mirrors userDirectory.ts's loadUserDirectory() shape (own getToken()
 * call, safe to call from every mount). By default fetches at most once
 * per session; `force: true` refetches regardless, for a caller that needs
 * to pick up a user account created after this session's one-shot load ran
 * (a new account isn't a tree edit, so useLiveSync's transaction-history
 * poll never notices it either). */
export function loadKnownUsersFromDirectory(force = false): void {
  if (directoryLoadPromise && !force) return;
  directoryLoadPromise = (async () => {
    if (!hasPermissions("ViewOtherUser") && !hasPermissions("ViewOtherTreeUser")) return;
    const token = await getToken();
    const all = await fetchAllUsers(token);
    let changed = false;
    for (const user of all) {
      if (!known.has(user.name)) {
        known.add(user.name);
        changed = true;
      }
      const wasGuest = guestUsers.has(user.name);
      if (user.role === ROLE_GUEST) guestUsers.add(user.name);
      else guestUsers.delete(user.name);
      if (wasGuest !== guestUsers.has(user.name)) changed = true;
    }
    if (changed) notify();
  })().catch((err) => {
    console.error("known users directory load failed", err);
    directoryLoadPromise = null;
  });
}
