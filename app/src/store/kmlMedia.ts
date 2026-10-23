// Fetching and reading a Place's attached map file(s) -- KML, GeoJSON or
// GPX (see mapFileMime.ts) -- shared between MapCanvas.tsx (which draws
// every currently-plotted place's shape) and useVisualData.ts (which needs
// a rough position for a place that has a map file attached but no
// lat/long of its own, see PendingKmlPlace). Both callers go through the
// same per-media-handle cache below, so a file fetched for one purpose is
// free the next time the other asks for it. Named for KML, the first
// format this app wrote; every format is read into the same GeoJSON
// features. Parsing, writing and overlay geometry are the story package's
// (@gramps-connect/story/map-edit), shared with the Story Editor; this
// file is the part that fetches from gramps-web-api.
import type { Feature } from "geojson";
import {
  cornersFromBox, isKmlLine, lineCoordsOf, MEDIA_HANDLE_PREFIX, overlaySourceOfText, parseMapFile, polygonRingsOf, type OverlayCorners,
} from "@gramps-connect/story/map-edit";
import { getToken } from "../auth/auth";
import { API_BASE } from "../config";
import { apiFetch } from "./apiFetch";

/** Media handle -> its parsed features, module-level so MapCanvas's overlay
 * and useVisualData's position guess never both fetch the same file, and
 * neither refetches one the other already has. A KML file was originally
 * static once uploaded (nothing to invalidate this on) until
 * MapItemEditorDialog.tsx's edit flow started replacing one in place --
 * see invalidateKmlFeatures below. */
const featureCache = new Map<string, Promise<Feature[]>>();
/** Media handle -> the Media an overlay was made from (map-edit's
 * SOURCE_PROPERTY), filled in by the same fetch. */
const sourceByHandle = new Map<string, string>();

/** The Media an overlay was made from, so re-saving it keeps the link. */
export async function fetchOverlaySource(handle: string): Promise<string | undefined> {
  await fetchKmlFeatures(handle);
  return sourceByHandle.get(handle);
}

/** A single map file's shapes, as GeoJSON. The same jwt-bearing
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
      const res = await apiFetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const text = await res.text();
      const source = overlaySourceOfText(text);
      if (source) sourceByHandle.set(handle, source);
      return parseMapFile(text);
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
 * bogus extra polygon into MapCanvas's (and the story player's) ordinary
 * fill/line layers on top of the actual image. */
export async function fetchAllKmlFeatures(handles: string[]): Promise<Feature[]> {
  if (handles.length === 0) return [];
  const collections = await Promise.all(handles.map(fetchKmlFeatures));
  return collections.flat().filter((f) => f.properties?.["@geometry-type"] !== "groundoverlay");
}

/** An image overlay drawn in MapItemEditorDialog.tsx (map-edit's
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
  /** The KML media object this overlay was parsed out of -- lets a caller
   * that fetched several places' KML at once (MapCanvas.tsx) trace an overlay back to the Place it's
   * attached to, whose own name.date gates this overlay's date
   * visibility (see kmlMediaToPlace-style lookups built by those
   * callers). */
  kmlHandle: string;
  /** Label shown in the Overlays panel/editor -- purely descriptive, no
   * effect on rendering. Undefined for an overlay saved before this field
   * existed. */
  name?: string;
  /** 0-1, applied as the rendered raster layer's `raster-opacity`. Defaults
   * to fully opaque for an overlay saved before this field existed. */
  opacity: number;
  /** Stacking rank among every overlay attached to the same place(s) --
   * higher draws on top. Defaults to this overlay's position in file/array
   * order (see fetchAllKmlImageOverlays), preserving a pre-existing file's
   * current visual stacking until the user deliberately reorders it. */
  order: number;
  /** This overlay's own position among only the other overlays living in
   * the same KML file -- distinct from `order`'s rank among every overlay
   * on the map (possibly spread across several files/places). Combined
   * with `kmlHandle` into the same rowKey OverlayLayersPanel.tsx's list
   * (and so MapCanvas.tsx's hiddenOverlayKeys/opacityOverrides) addresses
   * this overlay by. */
  indexInFile: number;
}

/** A drawn region (a Polygon or Rectangle shape from MapItemEditorDialog.tsx
 * -- both save as a plain Polygon placemark, see that dialog's own
 * selectedIsRegion) attached to a place, with the two properties
 * OverlayLayersPanel.tsx's own list needs: mirrors KmlImageOverlay's shape
 * for the same reason (one list covers both kinds of overlay). */
export interface KmlRegion {
  kmlHandle: string;
  /** This region's position in fetchAllKmlFeatures([kmlHandle])'s own
   * array (a region is an ordinary drawn placemark, not a GroundOverlay, so
   * this indexes the *features* array, not the overlays one) -- combined
   * with `kmlHandle` into the same rowKey OverlayLayersPanel.tsx's list
   * (and so MapCanvas.tsx's hiddenOverlayKeys/opacityOverrides) addresses
   * this region by. */
  indexInFile: number;
  name?: string;
  /** 0-1, mirrors MapCanvas.tsx's own KML_FILL_LAYER default -- an
   * unparseable/missing value there and here mean the same thing. */
  opacity: number;
  /** The outer ring's vertices (closing point included, same as GeoJSON's
   * own convention) -- enough for a rough centroid (see
   * OverlayLayersPanel.tsx's click-to-fly); holes, if any, don't matter for
   * that. */
  ring: [number, number][];
}

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
  for (let h = 0; h < handles.length; h++) {
    const kmlHandle = handles[h];
    // Counts only the accepted overlays *in this one file* -- what a
    // caller (OverlayLayersPanel.tsx) needs for this overlay's own rowKey,
    // rather than having to re-derive it by hand.
    let indexInFile = 0;
    for (const feature of collections[h]) {
      if (feature.properties?.["@geometry-type"] !== "groundoverlay") continue;
      const icon = feature.properties?.icon as string | undefined;
      if (!icon || !icon.startsWith(MEDIA_HANDLE_PREFIX)) continue;
      const imageHandle = icon.slice(MEDIA_HANDLE_PREFIX.length);
      // name/opacity/order round-trip the same ExtendedData way `rotation`
      // used to (see the comment below) -- a plain <Data name="..."> element,
      // which @tmcw/togeojson surfaces flattened onto `feature.properties`.
      // Missing/unparseable defaults to "no label", fully opaque, and this
      // overlay's own position among the ones already collected -- so an
      // older file (saved before these fields existed) keeps rendering
      // exactly as it did before.
      const name = (feature.properties?.name as string | undefined) || undefined;
      const opacityRaw = Number(feature.properties?.opacity);
      const opacity = Number.isFinite(opacityRaw) && opacityRaw >= 0 && opacityRaw <= 1 ? opacityRaw : 1;
      const orderRaw = Number(feature.properties?.order);
      const order = Number.isFinite(orderRaw) ? orderRaw : overlays.length * 10;
      const bbox = feature.bbox as [number, number, number, number] | undefined;
      if (bbox) {
        // An *old* overlay, saved before this app always wrote explicit
        // corners -- a plain <LatLonBox><rotation>. @tmcw/togeojson's own
        // LatLonBox parsing folds <rotation> straight into the geometry ring
        // it returns (bakes it into already-rotated coordinates) rather than
        // exposing the raw number anywhere -- so this app's KML writer used to also
        // write it redundantly as a plain ExtendedData property, the same
        // round-trip trick used for a drawn shape's `color`, read back here
        // instead of reverse-engineering the angle from the ring. Missing
        // (a save from before rotation existed at all) defaults to 0.
        const rotation = Number(feature.properties?.rotation ?? 0) || 0;
        const corners = cornersFromBox({ west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3], rotation });
        overlays.push({ imageHandle, corners, name, opacity, order, kmlHandle, indexInFile: indexInFile++ });
        continue;
      }
      // No bbox -- @tmcw/togeojson's getGroundOverlayBox() only omits it for
      // a <gx:LatLonQuad> overlay (what this app's KML writer used to write), whose 4 free
      // corners it instead returns as a Polygon ring (closed: first point
      // repeated last). A ring that isn't exactly that shape (a foreign file,
      // or a parse failure) is skipped, same as a missing bbox always was.
      const ring = feature.geometry?.type === "Polygon" ? (feature.geometry.coordinates[0] as [number, number][]) : undefined;
      if (!ring || ring.length !== 5) continue;
      overlays.push({
        imageHandle, corners: ring.slice(0, 4) as OverlayCorners, name, opacity, order, kmlHandle,
        indexInFile: indexInFile++,
      });
    }
  }
  return overlays;
}

/** Every drawn region (Polygon/Rectangle shape) across a place's KML
 * attachment(s) -- the counterpart to fetchAllKmlImageOverlays for
 * OverlayLayersPanel.tsx's own list, which shows both kinds of overlay
 * together. A GroundOverlay's own <gx:LatLonQuad> also parses to a Polygon
 * feature (see fetchAllKmlImageOverlays above), so those are explicitly
 * excluded here the same way fetchAllKmlFeatures already excludes them from
 * its own shape rendering. */
export async function fetchAllKmlRegions(handles: string[]): Promise<KmlRegion[]> {
  if (handles.length === 0) return [];
  const collections = await Promise.all(handles.map(fetchKmlFeatures));
  const regions: KmlRegion[] = [];
  for (let h = 0; h < handles.length; h++) {
    const kmlHandle = handles[h];
    // Every feature in this file (region or not) counts toward the index --
    // matches fetchAllKmlFeatures' own per-handle array position (it only
    // *filters out* the groundoverlay ones, which never precede a region in
    // write order -- see map-edit's mapItemToGeoJson on why image
    // overlays always come after every shape -- so the position
    // survives that filter unchanged), what this region's own rowKey needs.
    let indexInFile = 0;
    for (const feature of collections[h]) {
      if (feature.properties?.["@geometry-type"] === "groundoverlay") { indexInFile++; continue; }
      const rings = polygonRingsOf(feature);
      if (rings.length === 0) { indexInFile++; continue; }
      const name = (feature.properties?.name as string | undefined) || undefined;
      const opacityRaw = Number(feature.properties?.opacity);
      const opacity = Number.isFinite(opacityRaw) && opacityRaw >= 0 && opacityRaw <= 1 ? opacityRaw : 0.25;
      // A disjoint outline's rings are concatenated into one point list --
      // not a real ring, but boundsOf (the only thing regionToRow's own
      // ring.slice(0,-1) feeds it) only ever needs the full vertex set to
      // take a min/max over, so a disconnected piece (Hawaii, say) still
      // counts toward the fly-to bounding box.
      const ring = rings.flat() as [number, number][];
      regions.push({ kmlHandle, indexInFile: indexInFile++, name, opacity, ring });
    }
  }
  return regions;
}

/** A line (a route, a GPS track) attached to a place -- the counterpart to
 * KmlRegion for OverlayLayersPanel.tsx's list, which shows lines alongside
 * images and regions. Points get no row: a GPX file can carry dozens of
 * waypoints, which would bury the rest of the list. */
export interface KmlLine {
  kmlHandle: string;
  /** Same per-file feature index as KmlRegion.indexInFile -- see
   * fetchAllKmlRegions' own comment on why it lines up with MapCanvas.tsx's. */
  indexInFile: number;
  name?: string;
  /** Every vertex, across all of a multi-part line's parts -- only ever used
   * for its bounding box (the panel's click-to-fly). */
  coords: [number, number][];
}

/** Every line across a place's map file(s) -- fetchAllKmlRegions' twin,
 * counting indexInFile the same way. */
export async function fetchAllKmlLines(handles: string[]): Promise<KmlLine[]> {
  if (handles.length === 0) return [];
  const collections = await Promise.all(handles.map(fetchKmlFeatures));
  const lines: KmlLine[] = [];
  for (let h = 0; h < handles.length; h++) {
    let indexInFile = 0;
    for (const feature of collections[h]) {
      if (feature.properties?.["@geometry-type"] === "groundoverlay" || !isKmlLine(feature)) {
        indexInFile++;
        continue;
      }
      const name = (feature.properties?.name as string | undefined) || undefined;
      lines.push({
        kmlHandle: handles[h], indexInFile: indexInFile++, name, coords: lineCoordsOf(feature) as [number, number][],
      });
    }
  }
  return lines;
}

/** Drops a handle's cached parse -- called after MapItemEditorDialog.tsx
 * PUTs new content over an existing KML media object's file (same handle,
 * new bytes; see jobsApi.ts's updateMediaFile). Without this, MapCanvas's
 * overlay and story hydration would keep serving the pre-edit shapes for
 * the rest of the session, since featureCache is keyed on the handle alone
 * and a KML file was previously assumed static once uploaded. */
export function invalidateKmlFeatures(handle: string): void {
  featureCache.delete(handle);
  sourceByHandle.delete(handle);
}
