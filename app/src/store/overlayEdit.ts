// A focused "patch one overlay's own metadata" write path -- used by
// OverlayLayersPanel.tsx (the map's live Overlays list) rather than routing
// through MapItemEditorDialog.tsx's full drawing editor just to nudge an
// opacity slider or a stacking-order number. Reads the target KML media
// object's own shapes and overlays, patches only the one overlay asked for,
// and re-serializes the *whole* file back out unchanged otherwise -- so this
// never disturbs another overlay sharing the same file, and never touches
// any other KML media object at all (each overlay lives in exactly one
// file; see the plan on why that's what keeps edits independent).
import { fetchAllKmlFeatures, fetchAllKmlImageOverlays, invalidateKmlFeatures } from "./kmlMedia";
import { featuresToKml, type ImageOverlay } from "./kmlWrite";
import { updateMediaFile } from "./jobsApi";
import { KML_MIME } from "./visualData";

/** Patches the `indexInFile`-th image overlay (0-based, in the same order
 * fetchAllKmlImageOverlays([kmlHandle]) alone would return them) inside
 * `kmlHandle`'s own file. A no-op if that index no longer exists (the file
 * changed shape since the caller last looked). */
export async function patchOverlayInFile(
  token: string,
  kmlHandle: string,
  indexInFile: number,
  patch: Partial<Pick<ImageOverlay, "name" | "opacity" | "order">>,
): Promise<void> {
  const [features, overlays] = await Promise.all([
    fetchAllKmlFeatures([kmlHandle]),
    fetchAllKmlImageOverlays([kmlHandle]),
  ]);
  if (indexInFile < 0 || indexInFile >= overlays.length) return;
  const imageOverlays: ImageOverlay[] = overlays.map((o, i) => ({
    handle: o.imageHandle,
    corners: o.corners,
    name: i === indexInFile ? (patch.name ?? o.name) : o.name,
    opacity: i === indexInFile ? (patch.opacity ?? o.opacity) : o.opacity,
    order: i === indexInFile ? (patch.order ?? o.order) : o.order,
  }));
  const blob = new Blob([featuresToKml(features, imageOverlays)], { type: KML_MIME });
  await updateMediaFile(token, kmlHandle, blob, KML_MIME);
  invalidateKmlFeatures(kmlHandle);
}
