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
 * position-guessing below want them treated as one shape. */
export async function fetchAllKmlFeatures(handles: string[]): Promise<Feature[]> {
  if (handles.length === 0) return [];
  const collections = await Promise.all(handles.map(fetchKmlFeatures));
  return collections.flat();
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
