// OPFS persistence for a view's exported sql.js database -- ported verbatim
// from the original Layer 2/3 spike's browser.ts (since removed, see git
// history).
import { resetServerState } from "./cacheMeta";
import { VIEWS } from "./views";

export async function loadFromOpfs(filename: string): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const buf = await file.arrayBuffer();
    return buf.byteLength > 0 ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}

export async function saveToOpfs(filename: string, data: Uint8Array) {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data as BufferSource);
    await writable.close();
  } catch {
    // OPFS unavailable (e.g. WebKitGTK's standalone build) -- caching is
    // purely an optimization, so skip it rather than fail the caller.
  }
}

export async function clearOpfs(filename: string) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(filename);
  } catch {
    // Nothing to remove, or OPFS unavailable entirely -- either way there's
    // nothing stale left to worry about.
  }
}

/** Clears every view's OPFS cache, not just one -- the eager path for a
 * bulk server-side mutation this tab performs itself (Family Trees' Import
 * and Delete), which invalidates every view at once rather than
 * one row at a time through live sync.
 *
 * ensureLoaded() (viewStore.ts) would eventually catch this anyway, via the
 * staleness check in cacheMeta.ts -- but only on the next load of each
 * view, after a round trip. Dropping the files up front makes the caches
 * that this tab *knows* are dead go away immediately, and skips the
 * pointless "is it stale?" question for all of them. */
export async function clearAllOpfs(): Promise<void> {
  await Promise.all(VIEWS.map((view) => clearOpfs(view.opfsFilename)));
  // The memoized server state predates the change just made -- see
  // resetServerState()'s doc comment on why keeping it would make every
  // rebuilt cache record itself as already stale.
  resetServerState();
}
