// Gramplets are ordinary Gramps Media objects, classified by a "Gramplet"
// Tag rather than a MIME type -- see project memory (the pyodide-addon-poc
// entry) for why: a genuinely custom MIME type makes gramps-web-api's
// get_default_filename() raise "MIME type not recognized" (it only
// resolves its hard-coded table or Python's stdlib mimetypes database),
// which would need a backend change; tagging instead reuses the exact
// mechanism GENERATED_VIEW already uses for reports/exports
// (`exists(tags, name == '...')`), no backend change needed.
//
// This makes a Gramplet a real tree object: it syncs to every client and
// travels with a Gramps XML export. Authoring (creating one, or editing an
// existing one's code) is gated on GRAMPLET_AUTHOR_PERMISSION below, above
// ordinary Media edit rights -- see its own doc comment for why (discussion
// #4, F9: an ordinary Editor being able to silently change what code runs
// in another user's browser, under that user's own token, was flagged as a
// real trust problem, not just a load one). That gate is enforced
// client-side only (every caller in this app funnels through it, and
// GrampletEditDialog.tsx checks it again itself as a second line of
// defense) -- gramps-web-api has no dedicated Gramplet permission of its
// own, so the underlying Media object is still technically writable by
// anyone with plain EditObject via the raw API. Closing that for good
// needs a real backend permission, which is out of scope for a
// client-only fix.
import { API_BASE } from "../config";
import { getToken, hasPermissions } from "../auth/auth";
import { fetchPage, parseErrorMessage } from "../store/api";
import { MEDIA_VIEW } from "../store/views";
import { uploadMedia, updateMediaFile, setMediaDesc, getOrCreateTagHandle, tagAndDescribeMedia } from "../store/jobsApi";
import { OBJECT_TYPES } from "./objectEndpoints";
import type { Gramplet } from "./types";

export const GRAMPLET_TAG_NAME = "Gramplet";
const GRAMPLET_MIME = "application/json";

/** The permission every Gramplet-authoring entry point in this app gates
 * on (PyodidePocPanel.tsx's "Create new Gramplet" and per-tab edit-pencil,
 * MediaGrampletEditButton.tsx, MenuBar.tsx's "Add Gramplet…",
 * GrampletEditDialog.tsx itself) -- deliberately Owner-tier, not the plain
 * `EditObject` any Editor already has for every other Media object.
 * gramps-web-api has no permission of its own for "may author Gramplet
 * code" (it's an ordinary Media object server-side), so this reuses
 * `EditTree`: the closest existing Owner-tier permission in meaning, since
 * a Gramplet's code runs in *every viewer's* browser once they add it to
 * their own view, not just the author's -- the same "affects the tree for
 * everyone, not just your own edit" character `EditTree` already gates
 * elsewhere. */
export const GRAMPLET_AUTHOR_PERMISSION = "EditTree";

export function canAuthorGramplets(): boolean {
  return hasPermissions(GRAMPLET_AUTHOR_PERMISSION);
}

// Per-user, per-browser "which of my views does this Gramplet show a tab
// on" -- discussion #4, F9's other half: this used to be `addedViews` on
// the shared manifest itself (toggled via PyodidePocPanel.tsx's (+)/(-)
// glyphs, written back with the same saveGrampletManifest() PUT authoring
// uses), so one person's "add to my People view" pushed a tab into every
// other viewer's People view too, with no choice of their own in it. Now
// local-only, same localStorage-per-key pattern PyodidePocPanel.tsx's own
// panel `height`/`collapsed` already use -- never written back to the
// tree, and (unlike those two) not something authoring needs to touch, so
// removing a Gramplet from your own view needs no permission at all.
const ADDED_VIEWS_STORAGE_PREFIX = "gramps-connect:grampletAddedViews:";

function addedViewsStorageKey(grampletId: string): string {
  return `${ADDED_VIEWS_STORAGE_PREFIX}${grampletId}`;
}

/** This browser's own choice of which views show `grampletId` as a tab, or
 * null if never set here -- callers fall back to the Gramplet's own
 * (legacy, pre-F9) manifest `addedViews` in that case, see
 * effectiveAddedViews() below. */
function readLocalAddedViews(grampletId: string): string[] | null {
  try {
    const raw = localStorage.getItem(addedViewsStorageKey(grampletId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalAddedViews(grampletId: string, viewKeys: string[]): void {
  try {
    localStorage.setItem(addedViewsStorageKey(grampletId), JSON.stringify(viewKeys));
  } catch {
    // Storage full/unavailable -- the (+)/(-) toggle just won't stick
    // across a reload, not worth surfacing as an error over.
  }
}

/** Which views `gramplet` actually shows a tab on, in *this* browser --
 * this browser's own localStorage choice if it's ever touched the (+)/(-)
 * toggle for this Gramplet, else the value its manifest was saved with
 * (only ever non-empty for a Gramplet saved before F9 shipped -- see
 * normalizeGramplet() below, which is why an untouched *new* Gramplet
 * correctly starts out added to no view at all rather than every view). */
export function effectiveAddedViews(gramplet: Gramplet): string[] {
  const local = gramplet.id ? readLocalAddedViews(gramplet.id) : null;
  return local ?? gramplet.addedViews ?? [];
}

function isGramplet(value: unknown): value is Gramplet {
  if (!value || typeof value !== "object") return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.id === "string" &&
    typeof g.label === "string" &&
    typeof g.code === "string" &&
    (g.views === undefined || (Array.isArray(g.views) && g.views.every((v) => typeof v === "string"))) &&
    (g.addedViews === undefined ||
      (Array.isArray(g.addedViews) && g.addedViews.every((v) => typeof v === "string"))) &&
    (g.listensToSelection === undefined || typeof g.listensToSelection === "boolean")
  );
}

/** Fills in `views` when a manifest doesn't have it (the 3 seed examples,
 * uploaded before the field existed) -- "every object type" is exactly the
 * behavior those Gramplets already had (selectable everywhere), so this
 * keeps that rather than having them silently become unselectable the
 * moment this feature landed. `addedViews` gets no such fallback: a
 * missing value there means either the same pre-`addedViews` seed examples
 * (which showed as a tab everywhere before this app tracked *where*
 * separately from *can run where*, so `[]` -- not added to anything until
 * a viewer explicitly adds it via effectiveAddedViews()'s own localStorage
 * layer -- is a deliberate, one-time behavior change, not a bug) or,
 * post-F9, *every* Gramplet going forward, since authoring no longer
 * writes this field to the tree at all (see saveGrampletManifest()/
 * uploadGramplet() below) -- see effectiveAddedViews() for the per-viewer
 * value this manifest-level one now only ever seeds as a legacy default.
 * Also attaches `handle` (the Media object's own, not part of the stored
 * JSON -- see types.ts). */
function normalizeGramplet(gramplet: Gramplet, handle: string): Gramplet {
  return {
    ...gramplet,
    views: gramplet.views ?? OBJECT_TYPES,
    addedViews: gramplet.addedViews ?? [],
    handle,
  };
}

/** Every Media object tagged "Gramplet", with its raw file content parsed
 * as a Gramplet manifest. A tagged Media whose content isn't valid JSON in
 * that shape is skipped (logged, not thrown) rather than failing the whole
 * panel over one bad upload -- the same "don't let one bad row sink the
 * list" posture the rest of this app takes with cached data. */
export async function fetchGramplets(): Promise<Gramplet[]> {
  const token = await getToken();
  const { page } = await fetchPage(
    MEDIA_VIEW,
    token,
    null,
    false,
    `exists(tags, name == ${JSON.stringify(GRAMPLET_TAG_NAME)})`,
    MEDIA_VIEW.orderBy,
    100
  );
  const gramplets = await Promise.all(
    page.items.map(async (item): Promise<Gramplet | null> => {
      try {
        const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(item.handle)}/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await parseErrorMessage(res));
        const manifest: unknown = JSON.parse(await res.text());
        if (!isGramplet(manifest)) throw new Error("not a valid Gramplet manifest");
        return normalizeGramplet(manifest, item.handle);
      } catch (err) {
        console.warn(`[gramplets] skipping ${item.handle}:`, err);
        return null;
      }
    })
  );
  return gramplets.filter((g): g is Gramplet => g !== null);
}

/** One Gramplet's manifest by its Media handle, normalized the same way
 * fetchGramplets() does -- used by GrampletEditDialog.tsx (opening the
 * editor) rather than re-deriving from the already-fetched list, since
 * that list may be stale by the time a dialog opened from it is saved. */
export async function fetchGrampletManifest(handle: string): Promise<Gramplet> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const manifest: unknown = JSON.parse(await res.text());
  if (!isGramplet(manifest)) throw new Error("not a valid Gramplet manifest");
  return normalizeGramplet(manifest, handle);
}

/** Replaces an existing Gramplet's content in place (PUT, same handle) and
 * keeps `desc` mirroring its `label` -- called by GrampletEditDialog.tsx's
 * Save. Strips `handle` before writing -- it's runtime-only metadata (see
 * types.ts), never part of the stored JSON itself -- and `addedViews`:
 * post-F9 that's a per-viewer localStorage preference
 * (effectiveAddedViews()), never written back to the shared manifest, so
 * an author saving a code edit can't accidentally push their own
 * PyodidePocPanel tab layout onto every other viewer's. */
export async function saveGrampletManifest(handle: string, gramplet: Gramplet): Promise<void> {
  const token = await getToken();
  const { handle: _handle, addedViews: _addedViews, ...manifest } = gramplet;
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: GRAMPLET_MIME });
  await updateMediaFile(token, handle, blob, GRAMPLET_MIME);
  await setMediaDesc(token, handle, gramplet.label);
}

/** Uploads `gramplet` as a new "Gramplet"-tagged Media object: POST the
 * manifest as plain application/json (uploadMedia), get-or-create the
 * Gramplet tag, then set desc/tag_list (tagAndDescribeMedia) -- the same
 * three-step promotion jobsPromote.ts already does for reports/exports.
 * Strips `addedViews` for the same reason saveGrampletManifest() does --
 * see its own doc comment. The creating tab's own "show up here
 * immediately" behavior (PyodidePocPanel.tsx's "Create new Gramplet")
 * instead seeds *that browser's* localStorage preference after this
 * resolves, from the in-memory value newGramplet() set on the
 * not-yet-uploaded object -- see GrampletEditDialog.tsx's handleSave(). */
export async function uploadGramplet(gramplet: Gramplet): Promise<string> {
  const token = await getToken();
  const { addedViews: _addedViews, ...manifest } = gramplet;
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: GRAMPLET_MIME });
  const handle = await uploadMedia(token, blob, GRAMPLET_MIME);
  const tagHandle = await getOrCreateTagHandle(token, GRAMPLET_TAG_NAME);
  await tagAndDescribeMedia(token, handle, gramplet.label, tagHandle);
  return handle;
}
