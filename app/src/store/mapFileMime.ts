// The MIME types this app draws on the map as a place's overlay -- a
// boundary, a route, a set of named points -- rather than showing as a plain
// document. Deliberately import-free: views.ts and visualData.ts both need
// these, and visualData.ts already imports views.ts (a shared constant
// living in either one would be a cycle).

/** What Python's mimetypes module (and so Gramps' own media-add) resolves a
 * ".kml" file to, and the only format this app writes (kmlWrite.ts). */
export const KML_MIME = "application/vnd.google-earth.kml+xml";
/** RFC 7946's registered type -- gramps-web-api's MIME_TYPES (v3.24.0+). */
export const GEOJSON_MIME = "application/geo+json";
/** GPX's de facto type (it has no registered one) -- gramps-web-api's
 * MIME_TYPES (v3.24.0+). */
export const GPX_MIME = "application/gpx+xml";

/** Every type kmlMedia.ts can read. KMZ (zipped KML) is left out until
 * something here can unzip it: listing it would show a KMZ as an overlay
 * that then never draws. */
const MAP_FILE_MIMES: readonly string[] = [KML_MIME, GEOJSON_MIME, GPX_MIME];

const MIME_BY_EXTENSION: Record<string, string> = {
  kml: KML_MIME,
  geojson: GEOJSON_MIME,
  gpx: GPX_MIME,
};

export function isMapFileMime(mime: unknown): boolean {
  return typeof mime === "string" && MAP_FILE_MIMES.includes(mime);
}

/** The map file type a file name's extension implies, or null. Browsers
 * report an empty type for ".gpx" and ".geojson" (and sometimes ".kml"),
 * which would otherwise upload as application/octet-stream and never be
 * recognized as a map overlay -- see jobsApi.ts's uploadMediaFile. */
export function mapFileMimeForName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** A where_expr matching any map file, for ANDing into a Media picker. */
export function mapFileMimeExpr(): string {
  return `mime in [${MAP_FILE_MIMES.map((m) => `"${m}"`).join(", ")}]`;
}
