// Every username this session has ever seen -- unlike activeUsers.ts's
// trailing 5-minute window, this never decays, so it can back a "who do I
// send a DM to" picker with everyone this browser has ever noticed, not
// just who's currently active. Fed for free off the same useLiveSync poll
// activeUsers.ts already piggybacks on (see useLiveSync.ts's
// recordKnownUser(notification.changedBy) call), plus -- for a role that
// can see it -- the real user list, same ViewOtherUser/ViewOtherTreeUser
// guard userDirectory.ts's loadUserDirectory() already uses. A username a
// Contributor/Editor has never seen edit anything and never DMed with still
// isn't discoverable this way; the DM composer's recipient field keeps a
// free-text fallback for that case rather than pretending this list is
// exhaustive.
import { getToken, hasPermissions } from "../auth/auth";
import { fetchAllUsers } from "./adminApi";

const known = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];
let directoryLoadPromise: Promise<void> | null = null;

function recomputeSnapshot(): void {
  snapshot = Array.from(known).sort((a, b) => a.localeCompare(b));
}

function notify(): void {
  recomputeSnapshot();
  for (const listener of listeners) listener();
}

/** Records `username` as known -- called from useLiveSync.ts for every
 * table's changedBy (not just Notes), and from dmApi.ts's conversation
 * fetches for every author/recipient seen in a DM. */
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
 * mirrors userDirectory.ts's loadUserDirectory() shape exactly (own
 * getToken() call, at most one fetch per session, safe to call from every
 * mount). */
export function loadKnownUsersFromDirectory(): void {
  if (directoryLoadPromise) return;
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
    }
    if (changed) notify();
  })().catch((err) => {
    console.error("known users directory load failed", err);
    directoryLoadPromise = null;
  });
}
