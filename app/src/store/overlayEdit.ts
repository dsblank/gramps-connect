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

/** Patches some of `kmlHandle`'s own image overlays at once -- keyed by
 * `indexInFile` (0-based, in the same order fetchAllKmlImageOverlays
 * ([kmlHandle]) alone would return them), each mapping to the fields to
 * change on that one overlay. An index with no entry in `patches` (or one
 * that no longer exists -- the file changed shape since the caller last
 * looked) is left exactly as it was.
 *
 * Every patch destined for the same file must go through one call: this
 * does a single fetch-then-write pass over the whole file, and each call is
 * its own read of the file's current state. Patching overlay 0 and overlay
 * 1 of the same file via two *separate* calls -- e.g. two concurrent
 * per-overlay calls fired from a Promise.all -- would each independently
 * fetch the same pre-edit snapshot and rewrite the whole file from it, so
 * whichever write lands last silently discards the other's change (both
 * "know" only their own edit; neither has the other's). Found live via
 * OverlayLayersPanel's all-overlays-at-once opacity slider, where every
 * overlay sharing a file with another would randomly revert. */
export async function patchOverlaysInFile(
  token: string,
  kmlHandle: string,
  patches: Map<number, Partial<Pick<ImageOverlay, "name" | "opacity" | "order">>>,
): Promise<void> {
  const [features, overlays] = await Promise.all([
    fetchAllKmlFeatures([kmlHandle]),
    fetchAllKmlImageOverlays([kmlHandle]),
  ]);
  const imageOverlays: ImageOverlay[] = overlays.map((o, i) => {
    const patch = patches.get(i);
    return {
      handle: o.imageHandle,
      corners: o.corners,
      name: patch?.name ?? o.name,
      opacity: patch?.opacity ?? o.opacity,
      order: patch?.order ?? o.order,
    };
  });
  const blob = new Blob([featuresToKml(features, imageOverlays)], { type: KML_MIME });
  await updateMediaFile(token, kmlHandle, blob, KML_MIME);
  invalidateKmlFeatures(kmlHandle);
}
