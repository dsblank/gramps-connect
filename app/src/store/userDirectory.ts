// Best-effort username -> full_name lookup for chat-like message display
// (MessageComposer.tsx's bubbles) -- Note.text has no author field of its
// own, so notesApi.ts's createMessage stamps the signed-in username in as
// plain text (authoredText.ts), and that's what MessageBubble has to work
// with. Resolving it to a real name needs a directory of every user's
// full_name, but gramps-web-api only exposes that in bulk behind
// ViewOtherUser (Owner+, adminApi.ts's fetchAllUsers) -- a Contributor or
// Editor sending chat messages typically doesn't hold it. So this always
// resolves the signed-in user's own name (self-service, no permission
// needed beyond being logged in) and additionally resolves everyone else's
// whenever the role allows it; a username with no entry just displays as
// itself, same as before this existed.
import { getToken, hasPermissions } from "../auth/auth";
import { fetchAllUsers } from "./adminApi";
import { fetchOwnUser } from "./usersApi";

const fullNames = new Map<string, string>();
let loadPromise: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function subscribeUserDirectory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore snapshot -- bumps whenever fullNames gains an
 * entry, so callers re-render once the background load resolves. */
export function getUserDirectoryVersion(): number {
  return version;
}

/** The real name for `username`, or `username` itself when unresolved
 * (directory still loading, or this session's role can't see it). Pure
 * synchronous lookup -- pair with loadUserDirectory() to populate it and
 * subscribeUserDirectory()/getUserDirectoryVersion() to react to that. */
export function displayName(username: string): string {
  return fullNames.get(username) ?? username;
}

/** Kicks off the background fetch at most once per session. Safe to call
 * on every render of every message view -- callers don't need to coordinate
 * who "owns" the load. */
export function loadUserDirectory(): void {
  if (loadPromise) return;
  loadPromise = (async () => {
    const token = await getToken();
    let changed = false;

    const own = await fetchOwnUser(token);
    if (own.full_name) {
      fullNames.set(own.name, own.full_name);
      changed = true;
    }

    if (hasPermissions("ViewOtherUser") || hasPermissions("ViewOtherTreeUser")) {
      const all = await fetchAllUsers(token);
      for (const user of all) {
        if (user.full_name) {
          fullNames.set(user.name, user.full_name);
          changed = true;
        }
      }
    }

    if (changed) {
      version++;
      for (const listener of listeners) listener();
    }
  })().catch((err) => {
    console.error("user directory load failed", err);
    // Allow a later call (e.g. after login finishes) to retry.
    loadPromise = null;
  });
}
