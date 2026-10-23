// @vitest-environment jsdom
// jsdom for DOMParser, which parseMapFile's GPX/KML branches need.
import { describe, expect, it, vi } from "vitest";
import type { Feature } from "geojson";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("../apiFetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "../apiFetch";
import { isKmlLine, isKmlRegion, mapItemToGeoJson, parseMapFile } from "@gramps-connect/story/map-edit";
import {
  fetchAllKmlFeatures, fetchAllKmlImageOverlays, fetchAllKmlLines, fetchAllKmlRegions, fetchOverlaySource,
} from "../kmlMedia";
import {
  GEOJSON_MIME, GPX_MIME, KML_MIME, isMapFileMime, mapFileMimeForName,
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
});

// The GeoJSON cases are the story package's own tests (no DOMParser
// there); GPX and KML need jsdom's.
describe("parseMapFile", () => {
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

describe("mapItemToGeoJson round trip", () => {
  it("reads back shapes, image overlays and the source it was made from", async () => {
    const shape: Feature = {
      type: "Feature",
      properties: { name: "Farm", color: "#00aa00", opacity: 0.4, note: { by: "survey" } },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const text = mapItemToGeoJson([shape], [{ handle: "img1", corners, name: "1850 map", opacity: 0.6, order: 10 }], "src1");
    vi.mocked(apiFetch).mockImplementation(async () => new Response(text));

    // The image overlay is drawn as an image, not as a shape.
    const features = await fetchAllKmlFeatures(["h-roundtrip"]);
    expect(features).toEqual([shape]);
    expect(await fetchAllKmlImageOverlays(["h-roundtrip"])).toEqual([{
      imageHandle: "img1", corners, kmlHandle: "h-roundtrip", name: "1850 map", opacity: 0.6, order: 10, indexInFile: 0,
    }]);
    expect(await fetchOverlaySource("h-roundtrip")).toBe("src1");
    // Region rows still point at the right feature with an overlay after it.
    expect((await fetchAllKmlRegions(["h-roundtrip"])).map((r) => [r.indexInFile, r.name, r.opacity])).toEqual([[0, "Farm", 0.4]]);
  });
});
