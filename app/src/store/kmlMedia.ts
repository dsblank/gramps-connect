// Fetching and reading a Place's attached KML file(s) -- shared between
// MapCanvas.tsx (which draws every currently-plotted place's shape) and
// useVisualData.ts (which needs a rough position for a place that has a
// KML attachment but no lat/long of its own, see PendingKmlPlace). Both
// callers go through the same per-media-handle cache below, so a file
// fetched for one purpose is free the next time the other asks for it.
import type { Feature, Position } from "geojson";
import { kml } from "@tmcw/togeojson";
import { getToken } from "../auth/auth";
import { API_BASE } from "../config";

/** Media handle -> its parsed features, module-level so MapCanvas's overlay
 * and useVisualData's position guess never both fetch the same file, and
 * neither refetches one the other already has. A KML file was originally
 * static once uploaded (nothing to invalidate this on) until
 * MapItemEditorDialog.tsx's edit flow started replacing one in place --
 * see invalidateKmlFeatures below. */
const featureCache = new Map<string, Promise<Feature[]>>();

/** A single KML media object's shapes, as GeoJSON. The same jwt-bearing
 * fetch every other media read in this app uses (see
 * MediaThumbnail.tsx/GeneratedItemActions.tsx). A file that fails to fetch
 * or parse contributes nothing rather than failing the whole caller -- one
 * bad attachment shouldn't blank out another place's perfectly good one. */
function fetchKmlFeatures(handle: string): Promise<Feature[]> {
  const cached = featureCache.get(handle);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const text = await res.text();
      const dom = new DOMParser().parseFromString(text, "text/xml");
      // A Placemark with no Point/LineString/Polygon converts to a null
      // geometry (see @tmcw/togeojson's KMLOptions.skipNullGeometry) -- of
      // no use to a caller here, so dropped rather than threaded through as
      // `Feature<Geometry | null>` everywhere downstream.
      return kml(dom).features.filter((f): f is Feature => f.geometry !== null);
    } catch {
      return [];
    }
  })();
  featureCache.set(handle, promise);
  return promise;
}

/** Every feature across a place's KML attachment(s), combined -- a place
 * can carry more than one such file, and both the overlay and the
 * position-guessing below want them treated as one shape. Excludes
 * GroundOverlay placemarks (see fetchAllKmlImageOverlays) -- those aren't a
 * drawable Point/LineString/Polygon shape, and left in here would leak a
 * bogus extra polygon into MapCanvas/StoryMapBackground's ordinary
 * fill/line layers on top of the actual image. */
export async function fetchAllKmlFeatures(handles: string[]): Promise<Feature[]> {
  if (handles.length === 0) return [];
  const collections = await Promise.all(handles.map(fetchKmlFeatures));
  return collections.flat().filter((f) => f.properties?.["@geometry-type"] !== "groundoverlay");
}

/** An image overlay drawn in MapItemEditorDialog.tsx (kmlWrite.ts's
 * ImageOverlay, round-tripped) -- an axis-aligned box plus a rotation
 * about its own center (KML's own <LatLonBox><rotation> model; see
 * rotatePoint's own doc comment). */
export interface KmlImageOverlay {
  imageHandle: string;
  north: number;
  south: number;
  east: number;
  west: number;
  rotation: number;
}

const DEG_TO_RAD = Math.PI / 180;

/** Rotates one point by `rotationDeg` around `center`, in plain lng/lat
 * space -- exactly KML's <LatLonBox><rotation> semantics (positive =
 * counterclockwise), matching @tmcw/togeojson's own internal rotateBox
 * (which this mirrors) so a rotated overlay this app writes renders
 * identically everywhere it's read back, KML round-trip included. Not
 * Mercator-corrected -- a rotated box won't be a pixel-perfect visual
 * rotation at high latitudes, but that's an accepted quirk of LatLonBox
 * itself (Google Earth has the same one), not something introduced here.
 * Pass a negative `rotationDeg` to go the other way (world -> local). */
export function rotatePoint(point: [number, number], center: [number, number], rotationDeg: number): [number, number] {
  const angle = rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
}

/** An overlay's 4 corners, rotated about its own center -- top-left,
 * top-right, bottom-right, bottom-left, maplibre's own ImageSource
 * `coordinates` order. The one place both the editor and every read-only
 * renderer (MapCanvas.tsx, StoryMapBackground.tsx) compute an overlay's
 * actual on-map footprint, so they can never disagree. */
export function rotatedOverlayCorners(
  overlay: { north: number; south: number; east: number; west: number; rotation: number },
): [[number, number], [number, number], [number, number], [number, number]] {
  const center: [number, number] = [(overlay.west + overlay.east) / 2, (overlay.north + overlay.south) / 2];
  const corners: [number, number][] = [
    [overlay.west, overlay.north], [overlay.east, overlay.north], [overlay.east, overlay.south], [overlay.west, overlay.south],
  ];
  return corners.map((p) => rotatePoint(p, center, overlay.rotation)) as [
    [number, number], [number, number], [number, number], [number, number],
  ];
}

/** kmlWrite.ts writes an overlay's href as this marker string (not a real
 * URL) -- see that file's own doc comment on why. */
const MEDIA_HANDLE_PREFIX = "media-handle:";

/** Every GroundOverlay across a place's KML attachment(s) -- the same
 * shared per-handle cache as fetchAllKmlFeatures, so fetching both for the
 * same place only pays for the underlying file fetch/parse once. Anything
 * that doesn't parse (a foreign href not written by this app, a missing
 * bbox) is skipped rather than failing the whole caller, same as
 * fetchKmlFeatures' own best-effort fetch. */
export async function fetchAllKmlImageOverlays(handles: string[]): Promise<KmlImageOverlay[]> {
  if (handles.length === 0) return [];
  const collections = await Promise.all(handles.map(fetchKmlFeatures));
  const overlays: KmlImageOverlay[] = [];
  for (const feature of collections.flat()) {
    if (feature.properties?.["@geometry-type"] !== "groundoverlay") continue;
    const icon = feature.properties?.icon as string | undefined;
    if (!icon || !icon.startsWith(MEDIA_HANDLE_PREFIX)) continue;
    const bbox = feature.bbox as [number, number, number, number] | undefined;
    if (!bbox) continue;
    // @tmcw/togeojson's own LatLonBox parsing folds <rotation> straight
    // into the geometry ring it returns (bakes it into already-rotated
    // coordinates) rather than exposing the raw number anywhere -- so
    // kmlWrite.ts also writes it redundantly as a plain ExtendedData
    // property, the same round-trip trick used for a drawn shape's
    // `color`, read back here instead of reverse-engineering the angle
    // from the ring. Missing/unparsed (a pre-rotation save, or a file this
    // app didn't write) defaults to 0 -- an unrotated box, same as before
    // this feature existed.
    const rotation = Number(feature.properties?.rotation ?? 0) || 0;
    overlays.push({
      imageHandle: icon.slice(MEDIA_HANDLE_PREFIX.length),
      west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3], rotation,
    });
  }
  return overlays;
}

/** Drops a handle's cached parse -- called after MapItemEditorDialog.tsx
 * PUTs new content over an existing KML media object's file (same handle,
 * new bytes; see jobsApi.ts's updateMediaFile). Without this, MapCanvas's
 * overlay and StoryMapBackground would keep serving the pre-edit shapes for
 * the rest of the session, since featureCache is keyed on the handle alone
 * and a KML file was previously assumed static once uploaded. */
export function invalidateKmlFeatures(handle: string): void {
  featureCache.delete(handle);
}

function visitCoordinates(coords: unknown, bounds: [number, number, number, number]): void {
  if (typeof (coords as Position)[0] === "number") {
    const [lng, lat] = coords as Position;
    if (lng < bounds[0]) bounds[0] = lng;
    if (lat < bounds[1]) bounds[1] = lat;
    if (lng > bounds[2]) bounds[2] = lng;
    if (lat > bounds[3]) bounds[3] = lat;
    return;
  }
  for (const c of coords as unknown[]) visitCoordinates(c, bounds);
}

/** Every coordinate's bounding box across a set of KML features, as
 * [west, south, east, north] -- maplibre's own LngLatBoundsLike corner
 * order, so a caller can hand this straight to fitBounds/cameraForBounds to
 * frame a field boundary or a route at whatever zoom actually fits it,
 * rather than guessing one. Null when the features carry no coordinates at
 * all (an empty file, or every fetch above failed). */
export function kmlBounds(features: Feature[]): [west: number, south: number, east: number, north: number] | null {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "GeometryCollection") {
      for (const g of geometry.geometries) if ("coordinates" in g) visitCoordinates(g.coordinates, bounds);
      continue;
    }
    visitCoordinates(geometry.coordinates, bounds);
  }
  return Number.isFinite(bounds[0]) ? bounds : null;
}

/** The center of kmlBounds -- a plain bbox center rather than an
 * area-weighted centroid, which is all a "roughly where does this file sit"
 * marker position needs. */
export function kmlCenter(features: Feature[]): [lat: number, long: number] | null {
  const bounds = kmlBounds(features);
  if (!bounds) return null;
  return [(bounds[1] + bounds[3]) / 2, (bounds[0] + bounds[2]) / 2];
}
