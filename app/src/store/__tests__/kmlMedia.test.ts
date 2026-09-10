import { describe, expect, it } from "vitest";
import type { Feature } from "geojson";
import { isKmlRegion } from "../kmlMedia";

// isKmlRegion is what fetchAllKmlRegions (OverlayLayersPanel.tsx's list) and
// MapCanvas.tsx's shapes effect both gate their region handling on -- kept
// in sync via this one shared function after a real bug (found live,
// 2026-09-09) where a country-level outline (a disjoint MultiPolygon,
// round-tripped through kmlWrite.ts/tokml/@tmcw/togeojson as a
// GeometryCollection of Polygons -- see that function's own doc comment)
// drew on the map but never appeared in OverlayLayersPanel.tsx's controls,
// because only the panel's own Polygon-only check excluded it.
describe("isKmlRegion", () => {
  function feature(geometry: Feature["geometry"]): Feature {
    return { type: "Feature", properties: {}, geometry };
  }

  it("accepts a plain Polygon", () => {
    expect(isKmlRegion(feature({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }))).toBe(true);
  });

  it("accepts a GeometryCollection containing a Polygon (a disjoint outline's actual shape)", () => {
    expect(
      isKmlRegion(
        feature({
          type: "GeometryCollection",
          geometries: [
            { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
            { type: "Polygon", coordinates: [[[10, 10], [11, 10], [11, 11], [10, 10]]] },
          ],
        })
      )
    ).toBe(true);
  });

  it("rejects a GeometryCollection with no Polygon sub-geometry", () => {
    expect(
      isKmlRegion(
        feature({
          type: "GeometryCollection",
          geometries: [{ type: "Point", coordinates: [0, 0] }, { type: "LineString", coordinates: [[0, 0], [1, 1]] }],
        })
      )
    ).toBe(false);
  });

  it("rejects a bare LineString or Point", () => {
    expect(isKmlRegion(feature({ type: "LineString", coordinates: [[0, 0], [1, 1]] }))).toBe(false);
    expect(isKmlRegion(feature({ type: "Point", coordinates: [0, 0] }))).toBe(false);
  });

  it("rejects a null geometry", () => {
    expect(isKmlRegion(feature(null))).toBe(false);
  });
});
