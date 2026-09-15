// Custom Rules are ordinary Gramps Media objects, classified by a "Custom
// Rule" Tag -- the same reasoning as grampletMedia.ts's own
// GRAMPLET_TAG_NAME (reuses the tag-discovery mechanism GENERATED_VIEW
// established for reports/exports, avoiding a custom MIME type that would
// need a gramps-web-api change) applied to a second, unrelated concept, so
// it gets its own distinct tag rather than sharing "Gramplet"'s.
//
// A Custom Rule is the *primitive* half of the Filters feature: one
// atomic, named `where_expr`, user-authored via the one dedicated dialog
// that allows typing raw GOQL at all (FilterPickerDialog.tsx's "+ New
// custom rule..."). It's deliberately not gated behind Gramplet's
// GRAMPLET_AUTHOR_PERMISSION -- a where_expr is inert data with the same
// risk profile as any other Media edit, not code that runs in someone
// else's browser under their token. See project memory
// project_storage_backing_principle.md for the general Note-vs-Media
// reasoning, and project_saved_filters_persistence_plan.md for how this
// pairs with the composable half, SavedFilter (savedFilterMedia.ts).
import { getToken } from "../auth/auth";
import { fetchPage, parseErrorMessage } from "./api";
import { API_BASE } from "../config";
import type { GqlFilterNamespace, GqlFilterPreset } from "../data/gqlFilterPresets";
import { getOrCreateTagHandle, tagAndDescribeMedia, updateMediaFile, uploadMedia, deleteMedia } from "./jobsApi";
import { MEDIA_VIEW, viewForNamespace } from "./views";

export const CUSTOM_RULE_TAG_NAME = "Custom Rule";
const CUSTOM_RULE_MIME = "application/json";

export interface CustomRule {
  id: string;
  name: string;
  namespace: GqlFilterNamespace;
  /** Raw GOQL, exactly as typed -- no `{param}` substitution (unlike a
   * built-in GqlFilterPreset), see customRuleAsPreset() below. */
  whereExpr: string;
  /** The backing Media object's handle -- runtime-only, never part of the
   * stored JSON itself (stripped before every write, same convention
   * Gramplet.handle uses in pyodidePoc/types.ts). */
  handle?: string;
}

function isCustomRule(value: unknown): value is CustomRule {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    (c.namespace === "Person" || c.namespace === "Family") &&
    typeof c.whereExpr === "string"
  );
}

/** Every Media object tagged "Custom Rule", with its raw file content
 * parsed as a CustomRule. A tagged Media whose content isn't valid JSON
 * in that shape is skipped (logged, not thrown) -- same "don't let one
 * bad row sink the list" posture as grampletMedia.ts's own
 * fetchGramplets(). */
export async function fetchCustomRules(): Promise<CustomRule[]> {
  const token = await getToken();
  const { page } = await fetchPage(
    MEDIA_VIEW,
    token,
    null,
    false,
    `exists(tags, name == ${JSON.stringify(CUSTOM_RULE_TAG_NAME)})`,
    MEDIA_VIEW.orderBy,
    100
  );
  const rules = await Promise.all(
    page.items.map(async (item): Promise<CustomRule | null> => {
      try {
        const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(item.handle)}/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await parseErrorMessage(res));
        const parsed: unknown = JSON.parse(await res.text());
        if (!isCustomRule(parsed)) throw new Error("not a valid Custom Rule");
        return { ...parsed, handle: item.handle };
      } catch (err) {
        console.warn(`[customRules] skipping ${item.handle}:`, err);
        return null;
      }
    })
  );
  return rules.filter((c): c is CustomRule => c !== null);
}

// A plain module-level cache -- same "shared, non-reactive state a sibling
// component can read synchronously" convention filterPickerState.ts's own
// Map already uses. FilterPickerDialog.tsx keeps this in sync with its own
// (reactive) local state on every fetch/create/delete; ListHeader.tsx reads
// it to label a Custom-Rule-referencing row in its filter summary without
// fetching anything itself. Safe to treat as "fresh enough": the only way
// ListHeader.tsx's summary has anything to show at all is a non-empty
// FilterPickerDialog tree, which means that dialog has already been opened
// at least once this session (filterPickerState.ts is in-memory-only, so
// there's no other way to get a non-empty tree) -- and opening it is
// exactly what refreshes this cache below.
let cachedRules: CustomRule[] = [];

/** The last list refreshCustomRules() (or setCachedCustomRules()) produced
 * -- read synchronously, no network round trip. */
export function getCachedCustomRules(): CustomRule[] {
  return cachedRules;
}

/** Lets a caller that already has a fresher list (FilterPickerDialog.tsx,
 * after its own create/delete) push it into the cache without a redundant
 * refetch. */
export function setCachedCustomRules(list: CustomRule[]): void {
  cachedRules = list;
}

/** fetchCustomRules(), plus updating the shared cache -- the fetch
 * FilterPickerDialog.tsx should call instead of the plain one above,
 * purely so getCachedCustomRules() stays reasonably fresh for
 * ListHeader.tsx without that component fetching anything of its own. */
export async function refreshCustomRules(): Promise<CustomRule[]> {
  cachedRules = await fetchCustomRules();
  return cachedRules;
}

/** Replaces an existing Custom Rule's content in place (PUT, same handle)
 * and keeps `desc` mirroring its `name` -- same shape grampletMedia.ts's
 * saveGrampletManifest() uses. */
export async function saveCustomRuleManifest(handle: string, rule: CustomRule): Promise<void> {
  const token = await getToken();
  const { handle: _handle, ...manifest } = rule;
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: CUSTOM_RULE_MIME });
  await updateMediaFile(token, handle, blob, CUSTOM_RULE_MIME);
  await tagAndDescribeMedia(token, handle, rule.name, await getOrCreateTagHandle(token, CUSTOM_RULE_TAG_NAME));
}

/** Uploads `rule` as a new "Custom Rule"-tagged Media object -- same
 * three-step promotion (upload, get-or-create tag, tag+describe)
 * grampletMedia.ts's uploadGramplet() uses. */
export async function uploadCustomRule(rule: CustomRule): Promise<string> {
  const token = await getToken();
  const { handle: _handle, ...manifest } = rule;
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: CUSTOM_RULE_MIME });
  const handle = await uploadMedia(token, blob, CUSTOM_RULE_MIME);
  const tagHandle = await getOrCreateTagHandle(token, CUSTOM_RULE_TAG_NAME);
  await tagAndDescribeMedia(token, handle, rule.name, tagHandle);
  return handle;
}

/** Deletes the Media object backing a Custom Rule -- a thin wrapper over
 * jobsApi.ts's deleteMedia, same as grampletStore.ts's removeGramplet(). */
export async function removeCustomRule(handle: string): Promise<void> {
  const token = await getToken();
  await deleteMedia(token, handle);
}

/** Adapts a CustomRule into the minimal structural shape
 * goqlFilterCombiner.ts's render()/fillParams() actually read
 * (id/label/namespace/expr/params/supported/notes) -- so a caller can
 * merge built-in presets and fetched Custom Rules into one array and hand
 * it straight to combineFilterTree()/RowView/PresetSearchList with no
 * other change to that machinery. `category: "Custom"` is its own
 * GqlFilterCategory value, purely so the picker's search list can group it
 * apart from the built-in categories; `sourceRule` has no meaning for a
 * user-authored rule, so it's left empty. */
export function customRuleAsPreset(rule: CustomRule): GqlFilterPreset {
  return {
    id: rule.id,
    label: rule.name,
    category: "Custom",
    namespace: rule.namespace,
    sourceRule: "",
    expr: rule.whereExpr,
    supported: true,
  };
}

/** Checks whether `whereExpr` is valid GOQL for `namespace` by actually
 * running it -- a minimal (limit=1) query against that namespace's own
 * `/query/` endpoint (reusing api.ts's own fetchPage(), the same POST
 * every other view already sends, just capped to one row; the result
 * itself is never read, only whether the request succeeds). Used by
 * FilterPickerDialog.tsx's "Custom rules…" create/edit form to gate
 * Create/Save on a real server-side check -- a typo here would
 * otherwise only surface much later, the next time this rule is
 * actually used inside a tree. */
export async function validateWhereExpr(
  namespace: GqlFilterNamespace,
  whereExpr: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await getToken();
  try {
    const view = viewForNamespace(namespace);
    await fetchPage(view, token, null, false, whereExpr, view.orderBy, 1);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
