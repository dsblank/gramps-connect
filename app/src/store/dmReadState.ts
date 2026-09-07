// Per-conversation "last read" timestamps for direct messages, kept purely
// client-side in localStorage -- there's no shared read/unread Tag (unlike
// notesApi.ts's todo-open/todo-done pair) since that would need the
// *recipient* to hold EditObject just to mark something read, and would be
// shared, toggleable state visible to anyone with note-view permission.
// This is simpler and needs no extra permission, at the cost of not syncing
// "read" across the same person's other browsers/devices -- an accepted
// gap for a family-tree collaboration tool, not a production chat product.
// Same try/catch-around-localStorage shape as App.tsx's stored aside
// widths.
const STORAGE_KEY = "gramps-connect_dm_last_read";

function readStore(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable (private browsing etc.) -- read state just won't
    // survive a reload.
  }
}

/** Unix seconds, same units as the server's own `change` field
 * (formatChange()'s `unixSeconds` param) -- not Date.now()'s milliseconds,
 * so a stored "last read" value compares directly against a message's own
 * `change` timestamp with no unit conversion at the call site. */
export function getLastReadAt(partner: string): number {
  return readStore()[partner] ?? 0;
}

export function markRead(partner: string, atUnixSeconds: number = Math.floor(Date.now() / 1000)): void {
  const store = readStore();
  store[partner] = atUnixSeconds;
  writeStore(store);
}

/** `newestIncomingChange` is the newest message's `change` timestamp
 * *from that partner* (i.e. not one of my own sent messages), already in
 * unix seconds -- same units getLastReadAt/markRead store. */
export function isUnread(partner: string, newestIncomingChange: number | undefined): boolean {
  if (!newestIncomingChange) return false;
  return newestIncomingChange > getLastReadAt(partner);
}
