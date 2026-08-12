// OPFS persistence for a view's exported sql.js database -- ported verbatim
// from the original Layer 2/3 spike's browser.ts (since removed, see git
// history).
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
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data as BufferSource);
  await writable.close();
}

export async function clearOpfs(filename: string) {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(filename);
  } catch {
    // nothing to remove
  }
}

/** Clears every view's OPFS cache, not just one. ensureLoaded() (viewStore.ts)
 * trusts an on-disk cache unconditionally once it opens cleanly -- it never
 * checks the server for staleness -- so a bulk server-side mutation that
 * doesn't go through the normal per-row live-sync path (Family Trees'
 * Import and Delete all items) has to invalidate every view's cache itself,
 * or a reload just re-serves the same stale rows from disk. */
export async function clearAllOpfs(): Promise<void> {
  await Promise.all(VIEWS.map((view) => clearOpfs(view.opfsFilename)));
}
