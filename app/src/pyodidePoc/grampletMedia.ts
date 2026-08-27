// Gramplets are ordinary Gramps Media objects, classified by a "Gramplet"
// Tag rather than a MIME type -- see project memory (the pyodide-addon-poc
// entry) for why: a genuinely custom MIME type makes gramps-web-api's
// get_default_filename() raise "MIME type not recognized" (it only
// resolves its hard-coded table or Python's stdlib mimetypes database),
// which would need a backend change; tagging instead reuses the exact
// mechanism GENERATED_VIEW already uses for reports/exports
// (`exists(tags, name == '...')`), no backend change needed.
//
// This makes a Gramplet a real tree object: it syncs to every client,
// travels with a Gramps XML export, and (today, no extra work) is
// editable/deletable by anyone who can edit Media -- see the project
// memory's "known, accepted risk" note before building any permission
// scoping on top of this.
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { fetchPage, parseErrorMessage } from "../store/api";
import { MEDIA_VIEW } from "../store/views";
import { uploadMedia, updateMediaFile, setMediaDesc, getOrCreateTagHandle, tagAndDescribeMedia } from "../store/jobsApi";
import { OBJECT_TYPES } from "./objectEndpoints";
import type { Gramplet } from "./types";

export const GRAMPLET_TAG_NAME = "Gramplet";
const GRAMPLET_MIME = "application/json";

function isGramplet(value: unknown): value is Gramplet {
  if (!value || typeof value !== "object") return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.id === "string" &&
    typeof g.label === "string" &&
    typeof g.code === "string" &&
    (g.views === undefined || (Array.isArray(g.views) && g.views.every((v) => typeof v === "string"))) &&
    (g.addedViews === undefined ||
      (Array.isArray(g.addedViews) && g.addedViews.every((v) => typeof v === "string")))
  );
}

/** Fills in `views`/`addedViews` when a manifest doesn't have them (the 3
 * seed examples, uploaded before either field existed) -- "every object
 * type" is exactly the behavior those Gramplets already had (shown as a
 * tab on every list), so this keeps that rather than having them silently
 * vanish everywhere the moment this feature landed. Also attaches `handle`
 * (the Media object's own, not part of the stored JSON -- see types.ts). */
function normalizeGramplet(gramplet: Gramplet, handle: string): Gramplet {
  return {
    ...gramplet,
    views: gramplet.views ?? OBJECT_TYPES,
    addedViews: gramplet.addedViews ?? OBJECT_TYPES,
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
 * keeps `desc` mirroring its `label` -- shared by GrampletEditDialog.tsx's
 * Save and PyodidePocPanel.tsx's (+)/(-) addedViews toggles, so both go
 * through one path rather than two copies of the same
 * updateMediaFile()+setMediaDesc() pair. Strips `handle` before writing --
 * it's runtime-only metadata (see types.ts), never part of the stored
 * JSON itself. */
export async function saveGrampletManifest(handle: string, gramplet: Gramplet): Promise<void> {
  const token = await getToken();
  const { handle: _handle, ...manifest } = gramplet;
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: GRAMPLET_MIME });
  await updateMediaFile(token, handle, blob, GRAMPLET_MIME);
  await setMediaDesc(token, handle, gramplet.label);
}

/** Uploads `gramplet` as a new "Gramplet"-tagged Media object: POST the
 * manifest as plain application/json (uploadMedia), get-or-create the
 * Gramplet tag, then set desc/tag_list (tagAndDescribeMedia) -- the same
 * three-step promotion jobsPromote.ts already does for reports/exports. */
export async function uploadGramplet(gramplet: Gramplet): Promise<string> {
  const token = await getToken();
  const blob = new Blob([JSON.stringify(gramplet, null, 2)], { type: GRAMPLET_MIME });
  const handle = await uploadMedia(token, blob, GRAMPLET_MIME);
  const tagHandle = await getOrCreateTagHandle(token, GRAMPLET_TAG_NAME);
  await tagAndDescribeMedia(token, handle, gramplet.label, tagHandle);
  return handle;
}
