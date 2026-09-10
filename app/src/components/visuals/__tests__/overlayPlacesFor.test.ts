import { describe, expect, it } from "vitest";
import type { MapPlace, VisualData } from "../../../store/visualData";
import { EMPTY_VISUAL_DATA } from "../../../store/visualData";
import { OVERLAY_PLACES_CAP, OVERLAY_WALK_VISITED_CAP, overlayPlacesFor } from "../MapView";

// Real-bug regression: France's own départements/régions (its direct
// children) carry no overlay, but their children (two levels down) do -- a
// fixed one-level walk (the original design) missed those entirely. See
// overlayPlacesFor's own doc comment in MapView.tsx.
function place(handle: string, kmlMedia: string[] = []): MapPlace {
  return { handle, grampsId: handle, title: handle, lat: 0, long: 0, eventCount: 0, years: [], kmlMedia };
}

function dataOf(places: MapPlace[], childPlaces: Record<string, string[]>): VisualData {
  return { ...EMPTY_VISUAL_DATA, places, childPlaces: new Map(Object.entries(childPlaces)) };
}

describe("overlayPlacesFor", () => {
  it("returns nothing for no selection", () => {
    expect(overlayPlacesFor(null, EMPTY_VISUAL_DATA)).toEqual([]);
  });

  it("returns just the selected place when it has no children", () => {
    const france = place("france");
    expect(overlayPlacesFor(france, dataOf([france], {}))).toEqual([france]);
  });

  it("descends past a childless-of-overlays level to find overlays two levels down", () => {
    const france = place("france");
    const region = place("region", []);
    const department = place("department", ["kml-1"]);
    const data = dataOf(
      [france, region, department],
      { france: ["region"], region: ["department"] }
    );
    const result = overlayPlacesFor(france, data);
    expect(result.map((p) => p.handle)).toEqual(["france", "region", "department"]);
  });

  it("stops descending once enough overlay-bearing places are found", () => {
    const root = place("root");
    const overlayChildren = Array.from({ length: OVERLAY_PLACES_CAP + 5 }, (_, i) => place(`c${i}`, [`kml-${i}`]));
    // A grandchild that would only be reached by descending past the cap --
    // proves the walk actually stops once OVERLAY_PLACES_CAP is reached,
    // rather than merely capping the returned array's length after a full
    // descent.
    const grandchild = place("grandchild", ["kml-grandchild"]);
    const data = dataOf(
      [root, ...overlayChildren, grandchild],
      { root: overlayChildren.map((c) => c.handle), [overlayChildren[0].handle]: ["grandchild"] }
    );
    const result = overlayPlacesFor(root, data);
    expect(result.some((p) => p.handle === "grandchild")).toBe(false);
  });

  it("stops visiting once the total-visited safety cap is hit even with no overlays anywhere", () => {
    // A wide, overlay-free tree -- nothing here should make the walk stop
    // early on OVERLAY_PLACES_CAP, so OVERLAY_WALK_VISITED_CAP is the only
    // thing bounding it.
    const root = place("root");
    const children = Array.from({ length: OVERLAY_WALK_VISITED_CAP + 50 }, (_, i) => place(`c${i}`));
    const data = dataOf([root, ...children], { root: children.map((c) => c.handle) });
    const result = overlayPlacesFor(root, data);
    expect(result.length).toBeLessThanOrEqual(OVERLAY_WALK_VISITED_CAP);
  });

  it("never revisits a place, so a cycle in childPlaces terminates instead of hanging", () => {
    const a = place("a");
    const b = place("b");
    const data = dataOf([a, b], { a: ["b"], b: ["a"] });
    const result = overlayPlacesFor(a, data);
    expect(result.map((p) => p.handle)).toEqual(["a", "b"]);
  });
});
