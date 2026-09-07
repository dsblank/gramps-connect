import { lazy, Suspense, useState } from "react";
import { Box, Loader } from "@mantine/core";
import { getToken, hasPermissions } from "../../../auth/auth";
import { fetchObjectExtended, getBacklinks, zipRefs } from "../../../store/objectDetail";
import { attachRefListEntry, detachRefListEntry } from "../../../store/refListApi";
import { buildSimpleSearchExpr } from "../../../store/simpleSearch";
import { KML_MIME } from "../../../store/visualData";
import { MEDIA_VIEW, PLACE_VIEW } from "../../../store/views";
import { summaryLine } from "../summary";
import { AttachControl } from "../AttachControl";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";
import type { QueryItem } from "../../../store/api";
import { t } from "../../../i18n/i18n";

// maplibre-gl and terra-draw are the heaviest thing this app can pull in
// (see MapItemEditorDialog.tsx's own doc comment) -- lazy so a session that
// never edits or draws a new overlay from here never fetches either, same
// reasoning as MediaKmlEditButton.tsx's identical lazy import.
const MapItemEditorDialog = lazy(() =>
  import("../../MapItemEditorDialog").then((m) => ({ default: m.MapItemEditorDialog })));

// Same convention as MapItemEditorDialog.tsx's own imageOnlyExpr -- an
// always-on mime filter ANDed into whatever the user types, so the "Add map
// overlay" picker's default browse-all list is already narrowed to KML
// files, not just once something's searched for.
function kmlOnlyExpr(term: string): string | null {
  const termExpr = buildSimpleSearchExpr(["gramps_id", "desc", "path"])(term);
  const fixed = `mime == "${KML_MIME}"`;
  return termExpr ? `(${termExpr}) and ${fixed}` : fixed;
}

/** A place's own map overlays -- its `media_list` filtered down to KML
 * files (see MapItemEditorDialog.tsx). A map overlay always belongs to
 * exactly one place (see MapItemEditorTarget's own doc comment); picking an
 * "existing" one already attached elsewhere in the "+ Add map overlay"
 * picker (AttachControl.tsx's `onPick` override) moves it here -- detaching
 * it there first -- rather than letting the same overlay end up on two
 * places at once. Editing an overlay's own shapes is left to the Details
 * Pane (RefRow's own click-through to the Media object's detail, where
 * MediaKmlEditButton.tsx already lives) rather than a second "Edit" trigger
 * duplicated here. */
export function MapOverlaysSection({ detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs<{ mime?: string; desc?: string; path?: string }>(detail.media_list, detail.extended?.media)
    .filter(({ target }) => target?.mime === KML_MIME);
  const canAttach = hasPermissions("EditObject");
  const canCreate = hasPermissions("AddObject");
  const [adding, setAdding] = useState(false);
  if (rows.length === 0 && !canAttach) return null;

  const place = { handle: detail.handle, title: (detail.title as string | undefined) ?? "" };

  async function handleRemove(handle: string, target: { desc?: string; path?: string } | undefined) {
    const summary = summaryLine("media", target) || "this map overlay";
    if (!window.confirm(`Remove ${summary} from this place? This does not delete the overlay file itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, PLACE_VIEW, detail.handle, "media_list", handle);
    onRefetch?.();
  }

  /** AttachControl's own `onPick` override -- a map overlay belongs to
   * exactly one place, so picking one that's currently on a *different*
   * place moves it here (detach there, attach here) instead of duplicating
   * it, after a confirmation since that's a real change somewhere else in
   * the tree, not just an addition here. Already on this place, or on none
   * at all, needs no confirmation. */
  async function handlePickExisting(item: QueryItem) {
    const token = await getToken();
    const obj = await fetchObjectExtended(token, MEDIA_VIEW, item.handle);
    // Single slot, same convention as MapItemEditorDialog.tsx's own `place`
    // state -- an overlay is only ever treated as belonging to one place at
    // a time, so only the first backlink matters here.
    const attachedTo = (getBacklinks(obj).place as { handle: string; title?: string }[] | undefined)?.[0];
    if (attachedTo?.handle === detail.handle) return; // already here
    if (attachedTo) {
      const label = attachedTo.title || t("another place");
      if (!window.confirm(t(`This overlay is currently attached to ${label}. Move it here instead?`))) return;
      await detachRefListEntry(token, PLACE_VIEW, attachedTo.handle, "media_list", item.handle);
    }
    await attachRefListEntry(token, PLACE_VIEW, detail.handle, "media_list", { _class: "MediaRef", ref: item.handle });
    onRefetch?.();
  }

  return (
    <SectionShell label={t("Map overlays")}>
      {rows.map(({ ref, target }) => (
        <RefRow
          key={ref.ref}
          type="media"
          handle={ref.ref}
          obj={target}
          refMeta={ref}
          onNavigate={onNavigate}
          onRemove={canAttach ? () => handleRemove(ref.ref, target) : undefined}
        />
      ))}
      {canAttach && (
        <AttachControl
          targetView={PLACE_VIEW}
          targetHandle={detail.handle}
          pickerView={MEDIA_VIEW}
          listField="media_list"
          buildExpr={kmlOnlyExpr}
          itemLabel="map overlay"
          onPick={handlePickExisting}
          onCreateNew={canCreate ? () => setAdding(true) : undefined}
          createLabel="map overlay"
        />
      )}
      {adding && (
        <Suspense
          fallback={
            <Box style={{ position: "fixed", inset: 0, zIndex: 300 }}>
              <Loader size="sm" style={{ position: "absolute", top: "50%", left: "50%" }} />
            </Box>
          }
        >
          <MapItemEditorDialog
            target={{ kind: "new", place }}
            onClose={() => { setAdding(false); onRefetch?.(); }}
          />
        </Suspense>
      )}
    </SectionShell>
  );
}
