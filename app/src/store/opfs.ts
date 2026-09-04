// OPFS persistence for a view's exported sql.js database -- ported verbatim
// from the original Layer 2/3 spike's browser.ts (since removed, see git
// history).
import { getTreeId } from "../auth/auth";
import { resetServerState } from "./cacheMeta";
import { VIEWS } from "./views";

// Every view's opfsFilename (views.ts) is a fixed, tree-agnostic name (e.g.
// "app-cache-person.sqlite") -- fine when there's only ever one tree on the
// origin, but a multi-tree server shares this same origin (and so this same
// OPFS root) across every tree a user switches between. Without scoping,
// switching trees made ensureLoaded() load the *other* tree's cache, parse
// it, discover (via cacheMeta.ts's dbId check) that it belongs to a
// different database, and discard it -- a wasted parse-and-throw-away on
// every view's first visit after a switch, and full thrashing (each tree
// clobbering the other's file) on repeated switching. Suffixing the
// filename with the current tree id gives each tree its own slot instead.
function scopedFilename(filename: string): string {
  const treeId = getTreeId();
  return treeId ? `${filename}.${treeId}` : filename;
}

export async function loadFromOpfs(filename: string): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(scopedFilename(filename));
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
    const fileHandle = await root.getFileHandle(scopedFilename(filename), { create: true });
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
    await root.removeEntry(scopedFilename(filename));
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
