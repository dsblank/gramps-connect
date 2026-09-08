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
 * files (see MapItemEditorDialog.tsx). A map overlay can be attached to more
 * than one place (e.g. a boundary that covers several nearby settlements),
 * but not to the *same* place twice -- picking an "existing" one already on
 * this place in the "+ Add map overlay" picker (AttachControl.tsx's `onPick`
 * override) is a no-op rather than a duplicate ref. Editing an overlay's own
 * shapes is left to the Details Pane (RefRow's own click-through to the
 * Media object's detail, where MediaKmlEditButton.tsx already lives) rather
 * than a second "Edit" trigger duplicated here. */
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

  /** AttachControl's own `onPick` override -- a map overlay can be attached
   * to several places at once, so picking one that's already attached
   * *elsewhere* is fine and just adds this place as another owner. Picking
   * one already attached to *this* place is a no-op rather than a duplicate
   * `media_list` ref. */
  async function handlePickExisting(item: QueryItem) {
    const token = await getToken();
    const obj = await fetchObjectExtended(token, MEDIA_VIEW, item.handle);
    const attachedPlaces = (getBacklinks(obj).place as { handle: string }[] | undefined) ?? [];
    if (attachedPlaces.some((p) => p.handle === detail.handle)) return; // already here
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
