// The write side of kmlMedia.ts -- turning the shapes drawn/edited in
// MapItemEditorDialog.tsx back into a KML file to upload. `tokml` is
// `@tmcw/togeojson`'s sibling (same author, same GeoJSON<->KML boundary,
// just the opposite direction), so this mirrors kmlMedia.ts's own use of
// that library rather than introducing a second KML-writing approach.
import tokml from "tokml";
import type { Feature } from "geojson";

/** An image overlay, as MapItemEditorDialog.tsx tracks one -- an
 * axis-aligned box plus a rotation about its own center, referencing a
 * media object by handle. */
export interface ImageOverlay {
  handle: string;
  north: number;
  south: number;
  east: number;
  west: number;
  rotation: number;
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
  return (
    "<GroundOverlay>"
    + `<Icon><href>${href}</href></Icon>`
    + `<LatLonBox><north>${overlay.north}</north><south>${overlay.south}</south>`
    + `<east>${overlay.east}</east><west>${overlay.west}</west><rotation>${overlay.rotation}</rotation></LatLonBox>`
    // @tmcw/togeojson folds <rotation> straight into an already-rotated
    // geometry ring on read rather than exposing the raw number (see
    // kmlMedia.ts's own doc comment on this) -- written again here as
    // plain ExtendedData, the same trick a drawn shape's `color` already
    // uses, so kmlMedia.ts's reader can recover the exact value instead of
    // reverse-engineering an angle from the ring.
    + `<ExtendedData><Data name="rotation"><value>${overlay.rotation}</value></Data></ExtendedData>`
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
  return placemarks.replace("</Document>", `${overlaysXml}</Document>`);
}
