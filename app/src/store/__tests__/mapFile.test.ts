// @vitest-environment jsdom
// jsdom for DOMParser, which parseMapFile's GPX/KML branches need.
import { describe, expect, it, vi } from "vitest";
import type { Feature } from "geojson";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("../apiFetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "../apiFetch";
import { fetchAllKmlFeatures, fetchAllKmlLines, fetchAllKmlRegions, isKmlLine, isKmlRegion, parseMapFile } from "../kmlMedia";
import {
  GEOJSON_MIME, GPX_MIME, KML_MIME, isMapFileMime, mapFileMimeExpr, mapFileMimeForName,
} from "../mapFileMime";

describe("mapFileMime", () => {
  it("recognizes KML, GeoJSON and GPX but not plain JSON or KMZ", () => {
    expect([KML_MIME, GEOJSON_MIME, GPX_MIME].every(isMapFileMime)).toBe(true);
    // Saved filters, custom rules and gramplets are stored as application/json.
    expect(isMapFileMime("application/json")).toBe(false);
    expect(isMapFileMime("application/vnd.google-earth.kmz")).toBe(false);
    expect(isMapFileMime(undefined)).toBe(false);
  });

  it("maps a file name's extension, case-insensitively", () => {
    expect(mapFileMimeForName("walk.GPX")).toBe(GPX_MIME);
    expect(mapFileMimeForName("parish.boundary.geojson")).toBe(GEOJSON_MIME);
    expect(mapFileMimeForName("farm.kml")).toBe(KML_MIME);
    expect(mapFileMimeForName("photo.jpg")).toBeNull();
    expect(mapFileMimeForName("README")).toBeNull();
  });

  it("builds a where_expr listing every type", () => {
    expect(mapFileMimeExpr()).toBe(`mime in ["${KML_MIME}", "${GEOJSON_MIME}", "${GPX_MIME}"]`);
  });
});

describe("parseMapFile", () => {
  it("reads a GeoJSON FeatureCollection, taking simplestyle colours", () => {
    const features = parseMapFile(JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { stroke: "#ff0000" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
        {
          type: "Feature",
          properties: { fill: "#00ff00", stroke: "#000000", "fill-opacity": 0.5 },
          geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        },
        { type: "Feature", properties: { color: "#123456", stroke: "#ff0000" }, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: { name: "no shape" }, geometry: null },
      ],
    }));
    expect(features).toHaveLength(3);
    expect(features[0].properties).toMatchObject({ color: "#ff0000" });
    expect(features[1].properties).toMatchObject({ color: "#00ff00", opacity: 0.5 });
    // An explicit `color` wins over simplestyle.
    expect(features[2].properties).toMatchObject({ color: "#123456" });
  });

  it("accepts a single Feature or a bare Geometry", () => {
    const point = { type: "Point", coordinates: [3, 4] };
    expect(parseMapFile(JSON.stringify({ type: "Feature", properties: null, geometry: point }))[0].geometry).toEqual(point);
    expect(parseMapFile(`  ${JSON.stringify(point)}`)[0].geometry).toEqual(point);
  });

  it("reads a GPX track and its waypoints", () => {
    const features = parseMapFile(`<?xml version="1.0"?>
      <gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
        <wpt lat="51.48" lon="-3.18"><name>Grave</name></wpt>
        <trk><name>Walk</name><trkseg>
          <trkpt lat="51.48" lon="-3.18"><time>1990-05-01T10:00:00Z</time></trkpt>
          <trkpt lat="51.49" lon="-3.17"><time>1990-05-01T10:30:00Z</time></trkpt>
        </trkseg></trk>
      </gpx>`);
    const byName = Object.fromEntries(features.map((f) => [f.properties?.name, f]));
    expect(byName.Grave.geometry).toEqual({ type: "Point", coordinates: [-3.18, 51.48] });
    expect(byName.Walk.geometry).toEqual({ type: "LineString", coordinates: [[-3.18, 51.48], [-3.17, 51.49]] });
  });

  it("reads KML without taking colours from its styles", () => {
    // Leaves existing (foreign) KML overlays looking as they always have.
    const features = parseMapFile(`<?xml version="1.0"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
        <Style id="s"><LineStyle><color>ff0000ff</color></LineStyle></Style>
        <Placemark><name>Road</name><styleUrl>#s</styleUrl>
          <LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark>
        <Placemark><name>No geometry</name></Placemark>
      </Document></kml>`);
    expect(features).toHaveLength(1);
    expect(features[0].properties?.name).toBe("Road");
    expect(features[0].properties?.color).toBeUndefined();
  });

  it("throws on unparseable GeoJSON, which fetchKmlFeatures turns into no features", () => {
    expect(() => parseMapFile("{not json")).toThrow();
  });
});

describe("isKmlLine", () => {
  const feature = (geometry: Feature["geometry"]): Feature => ({ type: "Feature", properties: {}, geometry });
  const line = { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] };

  it("accepts a LineString, a multi-segment GPX track, and a KML MultiGeometry of lines", () => {
    expect(isKmlLine(feature(line))).toBe(true);
    expect(isKmlLine(feature({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }))).toBe(true);
    expect(isKmlLine(feature({ type: "GeometryCollection", geometries: [line, line] }))).toBe(true);
  });

  it("rejects points, regions, and collections that aren't all lines", () => {
    const polygon = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    expect(isKmlLine(feature({ type: "Point", coordinates: [0, 0] }))).toBe(false);
    expect(isKmlLine(feature(polygon))).toBe(false);
    expect(isKmlLine(feature({ type: "GeometryCollection", geometries: [line, polygon] }))).toBe(false);
    expect(isKmlLine(feature({ type: "GeometryCollection", geometries: [] }))).toBe(false);
  });
});

describe("fetchAllKmlLines", () => {
  it("indexes lines by the same per-file position MapCanvas.tsx stamps", async () => {
    const geojson = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "Parish" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { type: "Feature", properties: { name: "Old road" }, geometry: { type: "LineString", coordinates: [[0, 0], [2, 3]] } },
        { type: "Feature", properties: { name: "Church" }, geometry: { type: "Point", coordinates: [0.5, 0.5] } },
        { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [[[5, 5], [6, 6]], [[7, 7], [8, 9]]] } },
      ],
    };
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify(geojson)));
    const lines = await fetchAllKmlLines(["h-lines"]);
    expect(lines.map((l) => [l.indexInFile, l.name])).toEqual([[1, "Old road"], [3, undefined]]);
    expect(lines[1].coords).toEqual([[5, 5], [6, 6], [7, 7], [8, 9]]);
    // MapCanvas.tsx keys each feature by its index in fetchAllKmlFeatures'
    // array: the rows must point at the same features.
    const features = await fetchAllKmlFeatures(["h-lines"]);
    expect(lines.every((l) => isKmlLine(features[l.indexInFile]))).toBe(true);
    const regions = await fetchAllKmlRegions(["h-lines"]);
    expect(regions.map((r) => r.indexInFile)).toEqual([0]);
    expect(isKmlRegion(features[0])).toBe(true);
  });
});
