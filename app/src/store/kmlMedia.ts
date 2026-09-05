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

/** An overlay's 4 world corners, maplibre's own ImageSource `coordinates`
 * order (top-left, top-right, bottom-right, bottom-left) and type. */
export type OverlayCorners = [[number, number], [number, number], [number, number], [number, number]];

/** An image overlay drawn in MapItemEditorDialog.tsx (kmlWrite.ts's
 * ImageOverlay, round-tripped) -- always 4 explicit world corners.
 * MapItemEditorDialog.tsx's move/resize/rotate/corner-drag handles all
 * transform these same 4 points directly (translate, uniform scale-from-
 * center, uniform rotate-from-center, or move one point independently --
 * see that file's own mountOverlay), so a plain unwarped rectangle is just
 * the special case where the 4 points happen to describe one; there's no
 * separate "box" representation to keep in sync or fall back to. */
export interface KmlImageOverlay {
  imageHandle: string;
  corners: OverlayCorners;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** [lng,lat] -> normalized Web Mercator x/y (x east-positive, y
 * *south*-positive) -- the exact projection maplibre's own map.project()
 * uses internally, reimplemented here as plain math (no maplibre-gl
 * import) so this module stays free of that ~900KB dependency (see
 * MapItemEditorDialog.tsx's own doc comment on why maplibre-gl is always
 * behind a lazy import elsewhere in this app). Unlike raw [lng,lat],
 * Mercator x/y is locally isotropic -- equal scale in both directions at
 * any given point, which is the whole point of the projection -- making it
 * the correct space to rotate a box in; see rotatePoint. */
function mercatorFromLngLat([lng, lat]: [number, number]): [number, number] {
  const x = (180 + lng) / 360;
  const y = (180 - RAD_TO_DEG * Math.log(Math.tan(Math.PI / 4 + (lat * DEG_TO_RAD) / 2))) / 360;
  return [x, y];
}

/** mercatorFromLngLat's inverse. */
function lngLatFromMercator([x, y]: [number, number]): [number, number] {
  const lng = x * 360 - 180;
  const lat = 90 - 2 * Math.atan(Math.exp((y * 360 - 180) * DEG_TO_RAD)) * RAD_TO_DEG;
  return [lng, lat];
}

/** Rotates one point by `rotationDeg` around `center` (positive =
 * counterclockwise, matching KML's own <LatLonBox><rotation> convention)
 * -- done in Mercator-projected space (see mercatorFromLngLat), not raw
 * [lng,lat], so a rectangle stays a rectangle (right angles preserved)
 * after rotating, regardless of latitude. A naive rotation directly on
 * [lng,lat] -- this function's original implementation -- shears instead,
 * since a degree of longitude and a degree of latitude aren't the same
 * ground (or screen) distance away from the equator (found live: a square
 * image's corners visibly stopped being 90 degrees once rotated away from
 * 0). This app's own KML is never meant to be opened in an external KML
 * viewer (see kmlWrite.ts's own doc comment on why), so diverging here
 * from what Google Earth's own <LatLonBox><rotation> would render is an
 * acceptable trade for this app always rendering its own files correctly.
 * Pass a negative `rotationDeg` to go the other way (world -> local). */
export function rotatePoint(point: [number, number], center: [number, number], rotationDeg: number): [number, number] {
  const angle = rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [px, py] = mercatorFromLngLat(point);
  const [cx, cy] = mercatorFromLngLat(center);
  // Mercator y increases southward -- negated here so this rotation is
  // expressed in a conventional north-up, east-right plane (dx
  // east-positive, dy north-positive), keeping "positive rotationDeg =
  // counterclockwise" the same sense every caller already expects.
  const dx = px - cx;
  const dy = -(py - cy);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return lngLatFromMercator([cx + rx, cy - ry]);
}

/** Scales the distance from `center` to `point` by `scale`, in the same
 * Mercator-projected space rotatePoint rotates in -- so scaling a
 * rectangle (or an already-warped quad) uniformly from its own center
 * preserves its exact shape/aspect ratio regardless of latitude, the same
 * way rotatePoint preserves angles. MapItemEditorDialog.tsx's resize
 * handle applies this to all 4 corners at once (see mountOverlay). */
export function scalePoint(point: [number, number], center: [number, number], scale: number): [number, number] {
  const [px, py] = mercatorFromLngLat(point);
  const [cx, cy] = mercatorFromLngLat(center);
  return lngLatFromMercator([cx + (px - cx) * scale, cy + (py - cy) * scale]);
}

/** The distance between `a` and `b` in the same Mercator-projected space
 * scalePoint scales in -- not a real-world distance (Mercator distorts
 * those away from the equator), just a consistent unit for computing a
 * resize handle's before/after scale ratio, which only ever needs to be
 * internally consistent with scalePoint's own projection, not physically
 * meaningful on its own. */
export function mercatorDistance(a: [number, number], b: [number, number]): number {
  const [ax, ay] = mercatorFromLngLat(a);
  const [bx, by] = mercatorFromLngLat(b);
  return Math.hypot(bx - ax, by - ay);
}

/** The angle (degrees, positive = counterclockwise, 0 = due east) from
 * `from` to `to` -- measured in the same Mercator-projected, north-up
 * plane rotatePoint itself rotates in, so a caller tracking "how far has
 * the user dragged this handle around the center" gets an angle that
 * matches how rotatePoint will then actually render it (unlike a plain
 * atan2 on raw [lng,lat], which suffers the same latitude-dependent skew
 * rotatePoint's own doc comment describes). */
export function mercatorBearing(from: [number, number], to: [number, number]): number {
  const [fx, fy] = mercatorFromLngLat(from);
  const [tx, ty] = mercatorFromLngLat(to);
  return Math.atan2(-(ty - fy), tx - fx) * RAD_TO_DEG;
}

/** An axis-aligned box plus a rotation about its own center's 4 world
 * corners -- KML's own <LatLonBox><rotation> model. Only ever needed to
 * interpret an *old* overlay saved before this app always wrote explicit
 * corners (see fetchAllKmlImageOverlays); MapItemEditorDialog.tsx itself
 * only ever deals with corners directly, never this box shape, so this
 * isn't exported. */
function cornersFromBox(
  box: { north: number; south: number; east: number; west: number; rotation: number },
): OverlayCorners {
  const center: [number, number] = [(box.west + box.east) / 2, (box.north + box.south) / 2];
  const corners: [number, number][] = [
    [box.west, box.north], [box.east, box.north], [box.east, box.south], [box.west, box.south],
  ];
  return corners.map((p) => rotatePoint(p, center, box.rotation)) as OverlayCorners;
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
    const imageHandle = icon.slice(MEDIA_HANDLE_PREFIX.length);
    const bbox = feature.bbox as [number, number, number, number] | undefined;
    if (bbox) {
      // An *old* overlay, saved before this app always wrote explicit
      // corners -- a plain <LatLonBox><rotation>. @tmcw/togeojson's own
      // LatLonBox parsing folds <rotation> straight into the geometry ring
      // it returns (bakes it into already-rotated coordinates) rather than
      // exposing the raw number anywhere -- so kmlWrite.ts used to also
      // write it redundantly as a plain ExtendedData property, the same
      // round-trip trick used for a drawn shape's `color`, read back here
      // instead of reverse-engineering the angle from the ring. Missing
      // (a save from before rotation existed at all) defaults to 0.
      const rotation = Number(feature.properties?.rotation ?? 0) || 0;
      const corners = cornersFromBox({ west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3], rotation });
      overlays.push({ imageHandle, corners });
      continue;
    }
    // No bbox -- @tmcw/togeojson's getGroundOverlayBox() only omits it for
    // a <gx:LatLonQuad> overlay (kmlWrite.ts's own output), whose 4 free
    // corners it instead returns as a Polygon ring (closed: first point
    // repeated last). A ring that isn't exactly that shape (a foreign file,
    // or a parse failure) is skipped, same as a missing bbox always was.
    const ring = feature.geometry?.type === "Polygon" ? (feature.geometry.coordinates[0] as [number, number][]) : undefined;
    if (!ring || ring.length !== 5) continue;
    overlays.push({ imageHandle, corners: ring.slice(0, 4) as OverlayCorners });
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
