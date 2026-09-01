// The Gramplet Store: browse a catalog of ready-made Gramplets, install one
// into the tree, update it when the catalog publishes a newer version, or
// remove it. See gramplet-store/README.md (this repo's own catalog source,
// aggregated by app/scripts/build-gramplet-catalog.mjs) for the catalog's
// own format, and project memory `project_gramplet_store_plan.md` for the
// full feature plan.
//
// An installed Gramplet is nothing new -- it's an ordinary Gramplet (see
// types.ts), created via grampletMedia.ts's own uploadGramplet()/
// saveGrampletManifest(), exactly as if a viewer had pasted the same code
// into "Create new Gramplet" by hand. The only addition is three optional
// provenance fields on the manifest (Gramplet.sourceId/sourceVersion/
// sourceCodeHash, see types.ts) that let this module tell whether an
// installed copy is still the one the catalog shipped, or whether the
// catalog has since moved on to a newer version.
//
// Deliberately NOT gated on canAuthorGramplets() internally -- same
// division of responsibility grampletMedia.ts's own uploadGramplet()/
// saveGrampletManifest() already use: the permission is enforced once, at
// every real UI entry point (see grampletMedia.ts's
// GRAMPLET_AUTHOR_PERMISSION doc comment), not duplicated inside each
// logic-layer function that ends up calling them.
import { getToken } from "../auth/auth";
import { deleteMedia } from "../store/jobsApi";
import { saveGrampletManifest, uploadGramplet } from "./grampletMedia";
import type { CatalogEntry, Gramplet } from "./types";

// Provisional -- points at GitHub Pages serving this repo's own
// gramplet-store/ directory once Pages is enabled for it (see
// gramplet-store/README.md). Until then, fetchCatalog() below fails with a
// normal network error, which the Store panel (not yet built) shows as
// "Couldn't reach the Gramplet Store" rather than crashing -- see its own
// doc comment.
export const DEFAULT_CATALOG_URL = "https://dsblank.github.io/gramps-connect/gramplet-store/catalog.json";

/** A cheap, non-cryptographic checksum (32-bit FNV-1a, hex-encoded) --
 * plenty to detect "this code changed since install", the only thing it's
 * used for (Gramplet.sourceCodeHash, wasEditedSinceInstall() below). Not a
 * security boundary: nobody is protected from a deliberately-constructed
 * collision here, only from silently overwriting an accidental edit. */
export function hashCode(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Fetches and parses the catalog at `catalogUrl` -- plain, unauthenticated
 * fetch() (public static content, unlike every other request this app
 * makes -- see this file's own top comment). Throws a plain Error with a
 * message fit to show directly in the Store panel on any failure (network
 * error, non-2xx status, invalid JSON, or JSON that isn't an array) rather
 * than letting a raw fetch()/JSON.parse() exception surface -- callers
 * should still wrap this in their own try/catch, since a network failure
 * here is expected/routine (offline, catalog host down), not a bug. */
export async function fetchCatalog(catalogUrl: string = DEFAULT_CATALOG_URL): Promise<CatalogEntry[]> {
  let res: Response;
  try {
    res = await fetch(catalogUrl);
  } catch (err) {
    throw new Error(`Couldn't reach the Gramplet Store: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    throw new Error(`Gramplet Store returned ${res.status} ${res.statusText}`);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    throw new Error(`Gramplet Store catalog isn't valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Gramplet Store catalog isn't a list of entries");
  }
  return parsed as CatalogEntry[];
}

/** Resolves a CatalogEntry's `iconUrl` (a path relative to the catalog
 * itself, e.g. "icons/hello-table.png") against the catalog's own URL --
 * `new URL()` handles this correctly regardless of whether `catalogUrl`
 * ends in a filename (catalog.json) or a directory, since it always
 * resolves relative to the last path *segment* being replaced, exactly
 * like an `<a href>` on a normal web page. */
export function resolveCatalogAssetUrl(catalogUrl: string, relativeUrl: string): string {
  return new URL(relativeUrl, catalogUrl).toString();
}

/** The installed Gramplet (if any) whose `sourceId` matches `entry.id` --
 * how the Store panel decides whether to show "Install" or "Installed"/
 * "Update available" for a given catalog entry. A catalog entry installed
 * more than once (nothing prevents that -- see installFromCatalog()'s own
 * doc comment) returns whichever match `installed` lists first. */
export function findInstalledEntry(installed: Gramplet[], catalogId: string): Gramplet | undefined {
  return installed.find((g) => g.sourceId === catalogId);
}

/** Whether `entry` has a newer `version` than the one `gramplet` was last
 * installed/updated from. False (not "unknown") when `gramplet` wasn't
 * installed from this entry at all (`sourceId` mismatch, or never
 * installed) -- callers that already matched the two via
 * findInstalledEntry() won't hit that case, but this stays safe to call
 * on an arbitrary pair regardless. Plain inequality, not real semver
 * ordering -- flags "different", not "newer" specifically; good enough
 * since the catalog is the single source of truth an installed copy is
 * only ever compared against, never rolled back client-side. */
export function hasCatalogUpdate(gramplet: Gramplet, entry: CatalogEntry): boolean {
  return gramplet.sourceId === entry.id && gramplet.sourceVersion !== entry.version;
}

/** Whether `gramplet`'s own `code` has been hand-edited since it was last
 * installed/updated from the catalog -- Update should confirm with the
 * viewer before overwriting when this is true, rather than silently
 * discarding their changes. False for a Gramplet that was never installed
 * from the catalog at all (no `sourceCodeHash` to compare against). */
export function wasEditedSinceInstall(gramplet: Gramplet): boolean {
  return gramplet.sourceCodeHash !== undefined && hashCode(gramplet.code) !== gramplet.sourceCodeHash;
}

/** Builds the in-memory Gramplet a fresh install of `entry` becomes -- not
 * yet uploaded. Exported mainly for testing; installFromCatalog() is the
 * real entry point. `defaultViewKey`, when given, scopes `views` to just
 * that type and seeds `addedViews` with it too (in-memory only --
 * uploadGramplet() strips `addedViews` before writing, same as
 * GrampletEditDialog.tsx's own newGramplet(); a caller wanting the newly
 * installed Gramplet to actually show up as a tab immediately still needs
 * to call writeLocalAddedViews(built.id, built.addedViews) itself after a
 * successful install, exactly as PyodidePocPanel.tsx's "Create new
 * Gramplet" flow already does) -- omitted, it's installed usable
 * everywhere but shown nowhere yet, same "deliberate curation" default
 * newGramplet() uses. */
export function buildGrampletFromCatalogEntry(entry: CatalogEntry, defaultViewKey?: string): Gramplet {
  return {
    id: crypto.randomUUID(),
    label: entry.name,
    description: entry.description,
    code: entry.code,
    views: defaultViewKey ? [defaultViewKey] : entry.views,
    addedViews: defaultViewKey ? [defaultViewKey] : [],
    listensToSelection: entry.listensToSelection,
    listensToFilter: entry.listensToFilter,
    sourceId: entry.id,
    sourceVersion: entry.version,
    sourceCodeHash: hashCode(entry.code),
  };
}

/** Installs `entry` as a brand new Gramplet (a new Media object, a new
 * `id` -- see buildGrampletFromCatalogEntry()) and returns it with its
 * freshly assigned `handle` attached, the same shape fetchGramplets()
 * itself returns. Nothing stops installing the same catalog entry more
 * than once (each call makes an unrelated new Gramplet) -- that's a
 * deliberate non-restriction, not an oversight: e.g. installing "Filter"
 * twice to hand-customize one copy while keeping the stock one around is
 * a legitimate thing to want, and enforcing "only one copy of any given
 * sourceId" would need tracking removal history to not just re-block a
 * reinstall after someone deletes their only copy. */
export async function installFromCatalog(entry: CatalogEntry, defaultViewKey?: string): Promise<Gramplet> {
  const built = buildGrampletFromCatalogEntry(entry, defaultViewKey);
  const handle = await uploadGramplet(built);
  return { ...built, handle };
}

/** Overwrites `installed`'s code/description/views/listening flags with
 * `entry`'s current content and bumps its `sourceVersion`/
 * `sourceCodeHash` to match -- same PUT saveGrampletManifest() already
 * uses for an ordinary hand-edit save. Deliberately leaves `label`
 * untouched (a viewer's own rename of the tab is not "content" the
 * catalog owns) and `addedViews`/`handle`/`id`/`sourceId` alone (identity
 * and per-viewer tab placement, not something an update should disturb).
 *
 * Does NOT check wasEditedSinceInstall() itself -- whether to warn (and
 * how) before calling this on a hand-edited copy is a UI decision (the
 * Store panel's job), not something this logic-layer function should
 * decide unilaterally; call wasEditedSinceInstall(installed) first and
 * confirm with the viewer before calling this if it returns true. */
export async function updateFromCatalog(installed: Gramplet, entry: CatalogEntry): Promise<Gramplet> {
  if (!installed.handle) {
    throw new Error("Cannot update a Gramplet that hasn't been uploaded yet");
  }
  const updated: Gramplet = {
    ...installed,
    description: entry.description,
    code: entry.code,
    views: entry.views,
    listensToSelection: entry.listensToSelection,
    listensToFilter: entry.listensToFilter,
    sourceVersion: entry.version,
    sourceCodeHash: hashCode(entry.code),
  };
  await saveGrampletManifest(installed.handle, updated);
  return updated;
}

/** Deletes the Media object backing an installed Gramplet -- a thin
 * wrapper over jobsApi.ts's own deleteMedia(), the same generic Media
 * delete every other Media-backed feature in this app already uses (see
 * DeleteButton.tsx), not a second delete mechanism specific to Gramplets. */
export async function removeGramplet(handle: string): Promise<void> {
  const token = await getToken();
  await deleteMedia(token, handle);
}
