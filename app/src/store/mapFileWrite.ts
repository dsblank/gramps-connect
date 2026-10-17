// The write side of kmlMedia.ts: a map item as saved by
// MapItemEditorDialog.tsx (and WikidataPlaceLookupDialog.tsx's outlines) --
// always GeoJSON, whatever format the file was read from. GeoJSON keeps
// every property as JSON and multi-part shapes as they are, with no format
// translation to lose anything in; a GPS track's per-point times ride along
// in `coordinateProperties.times`, the same place @tmcw/togeojson's GPX/KML
// readers put them.
import type { Feature, FeatureCollection } from "geojson";
import type { OverlayCorners } from "./kmlMedia";

/** An image overlay, as MapItemEditorDialog.tsx tracks one -- always 4
 * explicit world corners; see kmlMedia.ts's KmlImageOverlay, which this
 * mirrors on the write side. */
export interface ImageOverlay {
  handle: string;
  corners: OverlayCorners;
  name?: string;
  opacity?: number;
  order?: number;
}

/** The property marking a feature as an image overlay rather than a shape:
 * its Polygon is the image's 4 corners (top-left, top-right, bottom-right,
 * bottom-left, closed), and `image` is the picture's Media handle. This
 * app's own convention -- plain GeoJSON has no image overlays -- read back
 * by kmlMedia.ts's parseMapFile. */
export const IMAGE_OVERLAY_PROPERTY = "gramps:image-overlay";

function overlayFeature(overlay: ImageOverlay): Feature {
  const ring = [...overlay.corners, overlay.corners[0]];
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      [IMAGE_OVERLAY_PROPERTY]: true,
      image: overlay.handle,
      ...(overlay.name ? { name: overlay.name } : {}),
      ...(overlay.opacity !== undefined && overlay.opacity !== 1 ? { opacity: overlay.opacity } : {}),
      ...(overlay.order !== undefined ? { order: overlay.order } : {}),
    },
  };
}

/** Records which Media object an overlay was made from (mapOverlays.ts) --
 * a "foreign member" of the FeatureCollection, which GeoJSON allows. */
export const SOURCE_PROPERTY = "gramps:source";

/** Every shape plus every image overlay, as one GeoJSON FeatureCollection.
 * Overlays go last: kmlMedia.ts's region/line row indexes count every
 * feature in the file but MapCanvas.tsx's leave overlays out, and the two
 * only agree while no overlay comes before a shape. */
export function mapItemToGeoJson(features: Feature[], overlays: ImageOverlay[] = [], source?: string): string {
  const collection: FeatureCollection & { [SOURCE_PROPERTY]?: string } = {
    type: "FeatureCollection",
    ...(source ? { [SOURCE_PROPERTY]: source } : {}),
    features: [...features, ...overlays.map(overlayFeature)],
  };
  return JSON.stringify(collection);
}
