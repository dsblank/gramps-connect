// Turning a map file's features into what MapItemEditorDialog.tsx's
// terra-draw canvas can edit, and back into features to save (as GeoJSON,
// see mapFileWrite.ts), with nothing dropped on the way. terra-draw only knows single Points,
// LineStrings and Polygons with 2D, at-most-9-decimal coordinates, and only
// keeps the few properties the editor itself sets (name/color/opacity) --
// while a KML, GeoJSON or GPX file can hold multi-part shapes, arbitrary
// properties and a GPS track's per-point times. So:
//
//   - a multi-part shape is split into single parts that share a group,
//     and rejoined on save (parts whose name/colour/opacity were changed
//     apart become separate shapes, since one KML Placemark has one style);
//   - every other property is set aside per part and put back on save;
//   - a track's times are kept only while its points are unchanged --
//     reshaped, it no longer matches the recording, so it saves as a plain
//     line;
//   - elevations are dropped (nothing in this app uses them);
//   - anything terra-draw still can't take (a polygon with holes, one that
//     crosses itself) is "locked": shown but not editable, and saved back
//     exactly as it was, rather than silently left out of the save.
import type { Feature, Geometry, LineString, Point, Polygon, Position } from "geojson";

/** What the editor reads and writes on each terra-draw feature itself. */
const EDITOR_OWNED = new Set(["name", "color", "opacity"]);
/** Parser bookkeeping with nothing worth saving: the per-point data that's
 * carried separately (coordinateProperties), @tmcw/togeojson's GPX type tag,
 * and a KML style reference whose <Style> doesn't come along. */
const DROPPED = new Set(["coordinateProperties", "_gpxType", "styleUrl", "@geometry-type"]);

export type EditableGeometry = Point | LineString | Polygon;
export type EditMode = "point" | "linestring" | "polygon";

/** One single-geometry part, ready for terra-draw. `sourceKey` rides on the
 * terra-draw feature as a property so save can find what was set aside. */
export interface EditablePart {
  sourceKey: string;
  mode: EditMode;
  geometry: EditableGeometry;
  name?: string;
  color?: string;
  opacity?: number;
}

interface PartSource {
  group: string;
  /** Position within its group, so rejoined parts keep their order. */
  index: number;
  extra: Record<string, unknown>;
  /** A track part's per-point times, and the (2D, rounded) points they
   * belong to -- kept only while the saved points still match. */
  times?: string[];
  coords?: Position[];
}

export interface EditSession {
  parts: EditablePart[];
  sources: Map<string, PartSource>;
  /** Parts terra-draw wouldn't accept -- see lockPart. */
  locked: Map<string, EditablePart>;
}

/** terra-draw rejects coordinates with more than 9 decimal places (its
 * coordinatePrecision) -- well under a millimetre, so rounding loses
 * nothing real. Also drops a third (elevation) value. */
function round2d(position: Position): Position {
  return [Number(position[0].toFixed(9)), Number(position[1].toFixed(9))];
}

function singleParts(geometry: Geometry): EditableGeometry[] {
  switch (geometry.type) {
    case "Point":
      return [{ type: "Point", coordinates: round2d(geometry.coordinates) }];
    case "LineString":
      return [{ type: "LineString", coordinates: geometry.coordinates.map(round2d) }];
    case "Polygon":
      return [{ type: "Polygon", coordinates: geometry.coordinates.map((ring) => ring.map(round2d)) }];
    case "MultiPoint":
      return geometry.coordinates.map((c) => ({ type: "Point", coordinates: round2d(c) }));
    case "MultiLineString":
      return geometry.coordinates.map((line) => ({ type: "LineString", coordinates: line.map(round2d) }));
    case "MultiPolygon":
      return geometry.coordinates.map((poly) => ({ type: "Polygon", coordinates: poly.map((ring) => ring.map(round2d)) }));
    case "GeometryCollection":
      return geometry.geometries.flatMap(singleParts);
  }
}

const modeOf = (geometry: EditableGeometry): EditMode =>
  geometry.type === "Point" ? "point" : geometry.type === "LineString" ? "linestring" : "polygon";

/** A feature's properties minus the editor's own and the parser's
 * bookkeeping -- kept as they are, nested values included. */
function extraProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (EDITOR_OWNED.has(key) || DROPPED.has(key) || value === undefined || value === null) continue;
    extra[key] = value;
  }
  return extra;
}

/** Each part's times, if the feature has them in @tmcw/togeojson's own
 * shape: string[] for a LineString, string[][] for a MultiLineString. */
function partTimes(feature: Feature, partCount: number): (string[] | undefined)[] {
  const times = (feature.properties?.coordinateProperties as { times?: unknown } | undefined)?.times;
  if (!Array.isArray(times) || times.length === 0) return [];
  if (feature.geometry?.type === "LineString" && times.every((t) => typeof t === "string")) {
    return [times as string[]];
  }
  if (feature.geometry?.type === "MultiLineString" && times.length === partCount && times.every(Array.isArray)) {
    return times as string[][];
  }
  return [];
}

/** Splits a file's features (kmlMedia.ts's fetchAllKmlFeatures) into
 * editable single parts. A polygon with holes is locked from the start:
 * terra-draw's polygon editing only knows an outer ring. */
export function prepareForEditing(features: Feature[]): EditSession {
  const session: EditSession = { parts: [], sources: new Map(), locked: new Map() };
  features.forEach((feature, f) => {
    if (!feature.geometry) return;
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const extra = extraProperties(properties);
    const geometries = singleParts(feature.geometry);
    const times = partTimes(feature, geometries.length);
    const opacityRaw = Number(properties.opacity);
    const opacity = Number.isFinite(opacityRaw) && opacityRaw >= 0 && opacityRaw <= 1 ? opacityRaw : undefined;
    geometries.forEach((geometry, index) => {
      const sourceKey = `f${f}p${index}`;
      const partTimesHere = times[index];
      const keepTimes = geometry.type === "LineString" && partTimesHere?.length === geometry.coordinates.length;
      session.sources.set(sourceKey, {
        group: `f${f}`, index, extra,
        ...(keepTimes ? { times: partTimesHere, coords: geometry.coordinates } : {}),
      });
      const part: EditablePart = {
        sourceKey, mode: modeOf(geometry), geometry,
        name: typeof properties.name === "string" ? properties.name : undefined,
        color: typeof properties.color === "string" ? properties.color : undefined,
        ...(geometry.type === "Polygon" ? { opacity } : {}),
      };
      if (geometry.type === "Polygon" && geometry.coordinates.length > 1) session.locked.set(sourceKey, part);
      else session.parts.push(part);
    });
  });
  return session;
}

/** Marks a part terra-draw refused to load (addFeatures' validation): it's
 * no longer editable, and assembleForSaving writes it back unchanged. */
export function lockPart(session: EditSession, sourceKey: string): void {
  const index = session.parts.findIndex((part) => part.sourceKey === sourceKey);
  if (index < 0) return;
  session.locked.set(sourceKey, session.parts[index]);
  session.parts.splice(index, 1);
}

/** A part as saved from the canvas: its (possibly edited) geometry and the
 * editor's own properties, plus the sourceKey it was loaded with -- absent
 * for a shape drawn new in this session. */
export interface SavedPart {
  sourceKey?: string;
  geometry: EditableGeometry;
  name?: string;
  color?: string;
  opacity?: number;
}

const samePositions = (a: Position[], b: Position[]) =>
  a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

/** Joins single geometries back into one -- Multi* when they're all one
 * kind, a GeometryCollection when mixed (what a KML MultiGeometry is). */
function joinGeometries(geometries: EditableGeometry[]): Geometry {
  if (geometries.length === 1) return geometries[0];
  const kinds = new Set(geometries.map((g) => g.type));
  if (kinds.size === 1) {
    if (kinds.has("Point")) return { type: "MultiPoint", coordinates: geometries.map((g) => (g as Point).coordinates) };
    if (kinds.has("LineString")) return { type: "MultiLineString", coordinates: geometries.map((g) => (g as LineString).coordinates) };
    return { type: "MultiPolygon", coordinates: geometries.map((g) => (g as Polygon).coordinates) };
  }
  return { type: "GeometryCollection", geometries };
}

/** Everything to save: the canvas's parts with their set-aside data put
 * back, multi-part shapes rejoined, and locked parts as they were loaded.
 * Features come out in their original file order, new shapes last. */
export function assembleForSaving(session: EditSession, saved: SavedPart[]): Feature[] {
  interface Entry { part: SavedPart; source?: PartSource }
  const entries: Entry[] = [
    ...saved.map((part) => ({ part, source: part.sourceKey ? session.sources.get(part.sourceKey) : undefined })),
    ...[...session.locked.values()].map((part) => ({ part, source: session.sources.get(part.sourceKey) })),
  ];
  // One bucket per original feature and style (a part restyled apart from
  // its siblings becomes its own shape), and one per new shape.
  const buckets = new Map<string, Entry[]>();
  let newCount = 0;
  for (const entry of entries) {
    const { part, source } = entry;
    const key = source
      ? `${source.group}|${part.name ?? ""}|${part.color ?? ""}|${part.opacity ?? ""}`
      : `new${newCount++}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }
  const groupOrder = (key: string) => (key.startsWith("new") ? Infinity : Number(key.slice(1, key.indexOf("|"))));
  return [...buckets.entries()]
    .sort(([a], [b]) => groupOrder(a) - groupOrder(b))
    .map(([, bucket]) => {
      bucket.sort((a, b) => (a.source?.index ?? 0) - (b.source?.index ?? 0));
      const first = bucket[0];
      const geometry = joinGeometries(bucket.map((e) => e.part.geometry));
      // Times only when every line in the shape still has its own, on
      // unchanged points -- @tmcw/togeojson's own shape for them is all of
      // a track's segments timed or none.
      const times = bucket.map(({ part, source }) =>
        part.geometry.type === "LineString" && source?.times && source.coords
          && samePositions(part.geometry.coordinates, source.coords)
          ? source.times
          : undefined);
      const allTimed = bucket.every((e) => e.part.geometry.type === "LineString") && times.every(Boolean);
      return {
        type: "Feature",
        geometry,
        properties: {
          ...(first.source?.extra ?? {}),
          ...(first.part.color !== undefined ? { color: first.part.color } : {}),
          ...(first.part.name ? { name: first.part.name } : {}),
          ...(first.part.opacity !== undefined ? { opacity: first.part.opacity } : {}),
          ...(allTimed ? { coordinateProperties: { times: bucket.length === 1 ? times[0] : times } } : {}),
        },
      } as Feature;
    });
}
