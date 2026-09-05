// The write side of kmlMedia.ts -- turning the shapes drawn/edited in
// MapItemEditorDialog.tsx back into a KML file to upload. `tokml` is
// `@tmcw/togeojson`'s sibling (same author, same GeoJSON<->KML boundary,
// just the opposite direction), so this mirrors kmlMedia.ts's own use of
// that library rather than introducing a second KML-writing approach.
import tokml from "tokml";
import type { Feature } from "geojson";
import type { OverlayCorners } from "./kmlMedia";

/** An image overlay, as MapItemEditorDialog.tsx tracks one -- always 4
 * explicit world corners; see kmlMedia.ts's KmlImageOverlay, which this
 * mirrors on the write side. */
export interface ImageOverlay {
  handle: string;
  corners: OverlayCorners;
}

/** kmlMedia.ts's fetchAllKmlImageOverlays looks for this exact prefix.
 * Deliberately not a real URL -- this KML is app-internal (round-tripped
 * only by this app's own reader), not meant to open in an external KML
 * viewer, so there's no reason to bake in a resolvable link (and every
 * resolvable link would need a possibly-expired auth token baked in too). */
const MEDIA_HANDLE_PREFIX = "media-handle:";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function overlayToKml(overlay: ImageOverlay): string {
  const href = escapeXml(`${MEDIA_HANDLE_PREFIX}${overlay.handle}`);
  const coords = overlay.corners.map(([lng, lat]) => `${lng},${lat}`).join(" ");
  // Google's <gx:LatLonQuad> extension (which featuresToKml's caller must
  // declare the xmlns:gx namespace for; see its own doc comment) rather
  // than KML's plain <LatLonBox> -- a box has no way to express 4
  // independent corners, and since every overlay is always tracked as 4
  // corners now (even a plain, never-warped rectangle is just 4 corners
  // that happen to describe one), there's no separate box-shaped case left
  // to special-case a <LatLonBox> for. Read back by kmlMedia.ts's own
  // bbox-vs-Polygon branch (a bbox-less GroundOverlay, i.e. an *old* file
  // saved before this app always used gx:LatLonQuad, is still read via
  // <LatLonBox>).
  return (
    "<GroundOverlay>"
    + `<Icon><href>${href}</href></Icon>`
    + `<gx:LatLonQuad><coordinates>${coords}</coordinates></gx:LatLonQuad>`
    + "</GroundOverlay>"
  );
}

/** Every drawn feature (plus any image overlays), as a single KML document
 * -- what MapItemEditorDialog.tsx uploads (new) or PUTs over an existing
 * file (edit). Features carry only a `color` property (see that dialog's
 * own doc comment on why a plain ExtendedData round-trip beats KML's
 * simplestyle styling). `tokml` has no GroundOverlay support (it only
 * knows GeoJSON's own geometry types), so overlays are appended as hand-
 * built XML, spliced in before `</Document>` -- the only extension point a
 * plain string return offers. */
export function featuresToKml(features: Feature[], overlays: ImageOverlay[] = []): string {
  const placemarks = tokml({ type: "FeatureCollection", features });
  if (overlays.length === 0) return placemarks;
  const overlaysXml = overlays.map(overlayToKml).join("");
  const withOverlays = placemarks.replace("</Document>", `${overlaysXml}</Document>`);
  // tokml's own <kml> tag only declares the plain KML namespace -- every
  // overlay's <gx:LatLonQuad> above needs xmlns:gx declared too, or
  // DOMParser's text/xml mode fails to parse the whole document (a silent
  // parser-error document, not a thrown exception) the next time this file
  // is read back in kmlMedia.ts.
  return withOverlays.replace(
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
  );
}
