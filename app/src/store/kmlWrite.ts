// The write side of kmlMedia.ts -- turning the shapes drawn/edited in
// MapItemEditorDialog.tsx back into a KML file to upload. `tokml` is
// `@tmcw/togeojson`'s sibling (same author, same GeoJSON<->KML boundary,
// just the opposite direction), so this mirrors kmlMedia.ts's own use of
// that library rather than introducing a second KML-writing approach.
import tokml from "tokml";
import type { Feature } from "geojson";

/** Every drawn feature, as a single KML document -- what
 * MapItemEditorDialog.tsx uploads (new) or PUTs over an existing file
 * (edit). No name/description/style options passed to tokml: the editor is
 * geometry-only, so there's nothing else on a feature worth encoding. */
export function featuresToKml(features: Feature[]): string {
  return tokml({ type: "FeatureCollection", features });
}
