// Which DM conversation (if any) is open right now -- a tiny module store
// so ActiveUsers.tsx's avatar row and DmInbox.tsx's conversation list can
// both open the same DmThread.tsx modal without either needing a prop
// threaded down through App.tsx. Same useSyncExternalStore shape as
// activeUsers.ts's listener set.
let openPeer: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function openDmThread(username: string): void {
  openPeer = username;
  notify();
}

export function closeDmThread(): void {
  openPeer = null;
  notify();
}

export function getOpenPeer(): string | null {
  return openPeer;
}

export function subscribeDmUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
