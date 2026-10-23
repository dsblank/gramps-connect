// What a map overlay is, and making one. An overlay is always its own
// GeoJSON Media object tagged OVERLAY_TAG_NAME, written only by this app
// (map-edit's mapItemToGeoJson) -- a map file someone uploads (KML, GPX, or GeoJSON
// from a mapping site) is never edited or converted itself: an overlay is
// made *from* it as a new file, and the original is attached to the same
// place(s) alongside it, so it stays the record of what was actually
// uploaded. One stored format means everything that draws or edits an
// overlay only ever deals with GeoJSON.
import type { Feature } from "geojson";
import { getToken } from "../auth/auth";
import { fetchPage } from "./api";
import { getOrCreateTagHandle, tagAndDescribeMedia, uploadMedia, uploadMediaFileDetailed } from "./jobsApi";
import { fetchAllKmlFeatures, fetchAllKmlImageOverlays } from "./kmlMedia";
import { GEOJSON_MIME } from "./mapFileMime";
import { mapItemToGeoJson, type ImageOverlay } from "@gramps-connect/story/map-edit";
import { fetchObjectExtended, getBacklinks } from "./objectDetail";
import { attachRefListEntry } from "./refListApi";
import { getViewStore } from "./registry";
import { MEDIA_VIEW, PLACE_VIEW, TAG_VIEW } from "./views";

export const OVERLAY_TAG_NAME = "Map overlay";

/** A where_expr matching overlays only, for a Media picker. */
export function overlayWhereExpr(): string {
  return `mime == "${GEOJSON_MIME}" and any(t.name == ${JSON.stringify(OVERLAY_TAG_NAME)} for t in tags)`;
}

let tagHandlePromise: Promise<string | null> | null = null;

/** The overlay tag's handle, looked up once per session -- null while no
 * overlay has ever been made (the tag is created with the first). For
 * telling overlays apart in a record's own media list, whose entries carry
 * tag handles, not names. */
export function findOverlayTagHandle(): Promise<string | null> {
  tagHandlePromise ??= (async () => {
    const token = await getToken();
    const { page } = await fetchPage(TAG_VIEW, token, null, false, `name == ${JSON.stringify(OVERLAY_TAG_NAME)}`, TAG_VIEW.orderBy, 1);
    return page.items[0]?.handle ?? null;
  })().catch(() => {
    tagHandlePromise = null;
    return null;
  });
  return tagHandlePromise;
}

/** True for an overlay, given a Media object (with `mime`/`tag_list`) and
 * the overlay tag's handle. */
export function isOverlay(media: object | undefined, tagHandle: string | null): boolean {
  const { mime, tag_list: tags } = (media ?? {}) as { mime?: unknown; tag_list?: unknown };
  return !!tagHandle && mime === GEOJSON_MIME && Array.isArray(tags) && tags.includes(tagHandle);
}

/** Parser bookkeeping that has no place in a saved overlay: @tmcw/
 * togeojson's GPX type tag and GroundOverlay marker, and a KML style
 * reference whose <Style> isn't carried over. A track's times
 * (coordinateProperties) are kept. */
function cleanFeature(feature: Feature): Feature {
  const { _gpxType, styleUrl, "@geometry-type": _type, ...properties } = (feature.properties ?? {}) as Record<string, unknown>;
  return { ...feature, properties };
}

/** Uploads a new overlay -- the GeoJSON, then its tag and description. */
export async function createOverlay(
  token: string, features: Feature[], overlays: ImageOverlay[], desc: string, source?: string,
): Promise<string> {
  const blob = new Blob([mapItemToGeoJson(features, overlays, source)], { type: GEOJSON_MIME });
  const handle = await uploadMedia(token, blob, GEOJSON_MIME);
  const tagHandle = await getOrCreateTagHandle(token, OVERLAY_TAG_NAME);
  tagHandlePromise = Promise.resolve(tagHandle);
  await tagAndDescribeMedia(token, handle, desc, tagHandle);
  return handle;
}

/** "walk.gpx" -> "walk": an overlay's description, from its original's. */
function descFromSource(desc: string): string {
  return desc.replace(/\.(kml|geojson|gpx)$/i, "") || desc;
}

/** Makes a new overlay from a map file (KML/GPX/GeoJSON Media), leaving
 * the file itself untouched, and attaches it to every place `placeHandles`
 * names. Null if the file holds nothing to draw. */
export async function makeOverlayFromMedia(
  token: string, sourceHandle: string, sourceDesc: string, placeHandles: string[],
): Promise<string | null> {
  const [features, imageOverlays] = await Promise.all([
    fetchAllKmlFeatures([sourceHandle]),
    fetchAllKmlImageOverlays([sourceHandle]),
  ]);
  if (features.length === 0 && imageOverlays.length === 0) return null;
  const overlays: ImageOverlay[] = imageOverlays.map(({ imageHandle, corners, name, opacity, order }) => ({
    handle: imageHandle, corners, name, opacity, order,
  }));
  const handle = await createOverlay(token, features.map(cleanFeature), overlays, descFromSource(sourceDesc), sourceHandle);
  // Sequential: attachRefListEntry is a GET-then-PUT of each place.
  for (const placeHandle of placeHandles) {
    await attachRefListEntry(token, PLACE_VIEW, placeHandle, "media_list", { _class: "MediaRef", ref: handle });
  }
  getViewStore("media").requeryDebounced();
  getViewStore("place").requeryDebounced();
  return handle;
}

/** "Make map overlay" on a map file's own detail: the new overlay goes on
 * every place the file is attached to. */
export async function makeOverlayForMediaDetail(sourceHandle: string): Promise<string | null> {
  const token = await getToken();
  const source = await fetchObjectExtended(token, MEDIA_VIEW, sourceHandle);
  const places = (getBacklinks(source).place as { handle: string }[] | undefined) ?? [];
  return makeOverlayFromMedia(token, sourceHandle, (source.desc as string | undefined) ?? "", places.map((p) => p.handle));
}

export interface MapFileUploadResult {
  overlays: number;
  /** Files that uploaded but held nothing to draw (still attached). */
  empty: string[];
  failed: { name: string; message: string }[];
}

/** A place's "Upload map file": each file is uploaded as itself and
 * attached to the place, and an overlay is made from it and attached too. */
export async function addMapFilesToPlace(placeHandle: string, files: File[]): Promise<MapFileUploadResult> {
  const token = await getToken();
  const result: MapFileUploadResult = { overlays: 0, empty: [], failed: [] };
  for (const file of files) {
    try {
      const { handle } = await uploadMediaFileDetailed(token, file);
      await attachRefListEntry(token, PLACE_VIEW, placeHandle, "media_list", { _class: "MediaRef", ref: handle });
      if (await makeOverlayFromMedia(token, handle, file.name, [placeHandle])) result.overlays++;
      else result.empty.push(file.name);
    } catch (err: any) {
      result.failed.push({ name: file.name, message: err.message ?? String(err) });
    }
  }
  getViewStore("media").requeryDebounced();
  return result;
}
