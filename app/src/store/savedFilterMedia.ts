// Saved Filters are ordinary Gramps Media objects, classified by a "Saved
// Filter" Tag -- the composable half of the Filters feature: a whole
// FilterTree (AND/OR/NOT rule groups over primitives), named and
// persisted, so FilterPickerDialog.tsx's picker/editor can be reopened
// later with a previous arrangement already loaded. Pairs with
// customRuleMedia.ts (the primitive half); see project memory
// project_saved_filters_persistence_plan.md and
// project_storage_backing_principle.md for why both are Media+tag rather
// than a Note, despite carrying pure JSON.
//
// A tree's rule rows reference a primitive by bare id (either a built-in
// GqlFilterPreset or a Custom Rule) -- this module knows nothing about how
// that id resolves; that's FilterPickerDialog.tsx's merged presetsById
// lookup, same one it already builds for combining and rendering the tree
// today.
import { getToken } from "../auth/auth";
import { fetchPage, parseErrorMessage } from "./api";
import { API_BASE } from "../config";
import type { GqlFilterNamespace } from "../data/gqlFilterPresets";
import type { FilterTree } from "./goqlFilterTree";
import { getOrCreateTagHandle, tagAndDescribeMedia, updateMediaFile, uploadMedia, deleteMedia } from "./jobsApi";
import { MEDIA_VIEW } from "./views";

export const SAVED_FILTER_TAG_NAME = "Saved Filter";
const SAVED_FILTER_MIME = "application/json";

export interface SavedFilter {
  id: string;
  name: string;
  namespace: GqlFilterNamespace;
  tree: FilterTree;
  /** The backing Media object's handle -- runtime-only, never part of the
   * stored JSON itself, same convention CustomRule.handle uses. */
  handle?: string;
}

function isFilterTree(value: unknown): value is FilterTree {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    (t.namespace === "Person" || t.namespace === "Family") &&
    !!t.root && typeof t.root === "object"
  );
}

function isSavedFilter(value: unknown): value is SavedFilter {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    typeof f.name === "string" &&
    (f.namespace === "Person" || f.namespace === "Family") &&
    isFilterTree(f.tree)
  );
}

/** Every Media object tagged "Saved Filter", with its raw file content
 * parsed as a SavedFilter -- same skip-and-log posture as
 * customRuleMedia.ts's fetchCustomRules()/grampletMedia.ts's
 * fetchGramplets(). */
export async function fetchSavedFilters(): Promise<SavedFilter[]> {
  const token = await getToken();
  const { page } = await fetchPage(
    MEDIA_VIEW,
    token,
    null,
    false,
    `any(t.name == ${JSON.stringify(SAVED_FILTER_TAG_NAME)} for t in tags)`,
    MEDIA_VIEW.orderBy,
    100
  );
  const filters = await Promise.all(
    page.items.map(async (item): Promise<SavedFilter | null> => {
      try {
        const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(item.handle)}/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await parseErrorMessage(res));
        const parsed: unknown = JSON.parse(await res.text());
        if (!isSavedFilter(parsed)) throw new Error("not a valid Saved Filter");
        return { ...parsed, handle: item.handle };
      } catch (err) {
        console.warn(`[savedFilters] skipping ${item.handle}:`, err);
        return null;
      }
    })
  );
  return filters.filter((f): f is SavedFilter => f !== null);
}

/** Replaces an existing Saved Filter's content in place (PUT, same handle)
 * and keeps `desc` mirroring its `name` -- FilterPickerDialog.tsx's
 * "Update" action (Build panel, editing a specific Saved Filter via its
 * own explicit "Edit rules…" door from the Load panel; see
 * project_saved_filters_persistence_plan.md for why editing isn't
 * otherwise possible). */
export async function saveSavedFilterManifest(handle: string, filter: SavedFilter): Promise<void> {
  const token = await getToken();
  const { handle: _handle, ...manifest } = filter;
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: SAVED_FILTER_MIME });
  await updateMediaFile(token, handle, blob, SAVED_FILTER_MIME);
  await tagAndDescribeMedia(token, handle, filter.name, await getOrCreateTagHandle(token, SAVED_FILTER_TAG_NAME));
}

/** Uploads `filter` as a new "Saved Filter"-tagged Media object -- same
 * three-step promotion as customRuleMedia.ts's
 * uploadCustomRule()/grampletMedia.ts's uploadGramplet(). */
export async function uploadSavedFilter(filter: SavedFilter): Promise<string> {
  const token = await getToken();
  const { handle: _handle, ...manifest } = filter;
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: SAVED_FILTER_MIME });
  const handle = await uploadMedia(token, blob, SAVED_FILTER_MIME);
  const tagHandle = await getOrCreateTagHandle(token, SAVED_FILTER_TAG_NAME);
  await tagAndDescribeMedia(token, handle, filter.name, tagHandle);
  return handle;
}

/** Deletes the Media object backing a Saved Filter -- a thin wrapper over
 * jobsApi.ts's deleteMedia. */
export async function removeSavedFilter(handle: string): Promise<void> {
  const token = await getToken();
  await deleteMedia(token, handle);
}
