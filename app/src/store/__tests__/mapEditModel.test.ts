import { describe, expect, it } from "vitest";
import type { Feature } from "geojson";
import { assembleForSaving, lockPart, prepareForEditing, type SavedPart } from "../mapEditModel";

const feature = (geometry: Feature["geometry"], properties: Record<string, unknown> = {}): Feature =>
  ({ type: "Feature", geometry, properties });

/** The canvas saving every part exactly as loaded -- what an editor session
 * with no changes produces. */
const unchanged = (session: ReturnType<typeof prepareForEditing>): SavedPart[] =>
  session.parts.map(({ sourceKey, geometry, name, color, opacity }) => ({ sourceKey, geometry, name, color, opacity }));

describe("prepareForEditing / assembleForSaving", () => {
  it("round-trips an untouched file without losing anything but elevation", () => {
    const track = feature(
      { type: "LineString", coordinates: [[1, 2, 30], [3, 4, 31], [5, 6, 32]] },
      { name: "Walk", desc: "To the grave", link: { href: "https://example.org" }, _gpxType: "trk",
        coordinateProperties: { times: ["t1", "t2", "t3"] } },
    );
    const session = prepareForEditing([track]);
    expect(session.parts[0].geometry).toEqual({ type: "LineString", coordinates: [[1, 2], [3, 4], [5, 6]] });
    expect(assembleForSaving(session, unchanged(session))).toEqual([{
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[1, 2], [3, 4], [5, 6]] },
      // Nested values kept as they are; the parser's _gpxType isn't.
      properties: { name: "Walk", desc: "To the grave", link: { href: "https://example.org" },
        coordinateProperties: { times: ["t1", "t2", "t3"] } },
    }]);
  });

  it("drops a track's times once its points change", () => {
    const session = prepareForEditing([feature(
      { type: "LineString", coordinates: [[1, 2], [3, 4], [5, 6]] },
      { coordinateProperties: { times: ["t1", "t2", "t3"] } },
    )]);
    const [part] = unchanged(session);
    const moved = { ...part, geometry: { type: "LineString" as const, coordinates: [[1, 2], [3, 9], [5, 6]] } };
    expect(assembleForSaving(session, [moved])[0].properties).not.toHaveProperty("coordinateProperties");
  });

  it("splits a multi-segment track for editing and rejoins it with its times", () => {
    const session = prepareForEditing([feature(
      { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
      { name: "Trip", coordinateProperties: { times: [["a", "b"], ["c", "d"]] } },
    )]);
    expect(session.parts.map((p) => p.geometry.type)).toEqual(["LineString", "LineString"]);
    const [saved] = assembleForSaving(session, unchanged(session).reverse());
    expect(saved.geometry).toEqual({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] });
    expect(saved.properties).toMatchObject({ name: "Trip", coordinateProperties: { times: [["a", "b"], ["c", "d"]] } });
  });

  it("makes a part restyled apart from its siblings its own shape, keeping their shared properties", () => {
    const session = prepareForEditing([feature(
      { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] },
      { name: "Parish", color: "#ff0000", source: "survey" },
    )]);
    const [a, b] = unchanged(session);
    const saved = assembleForSaving(session, [a, { ...b, color: "#0000ff" }]);
    expect(saved.map((f) => [f.geometry.type, f.properties?.color, f.properties?.source]))
      .toEqual([["Polygon", "#ff0000", "survey"], ["Polygon", "#0000ff", "survey"]]);
  });

  it("drops a part the user deleted, and adds a newly drawn shape last", () => {
    const session = prepareForEditing([feature({ type: "MultiPoint", coordinates: [[0, 0], [1, 1]] }, { name: "Graves" })]);
    const [first] = unchanged(session);
    const drawn: SavedPart = { geometry: { type: "Point", coordinates: [9, 9] }, color: "#00ff00" };
    const saved = assembleForSaving(session, [drawn, first]);
    expect(saved.map((f) => f.geometry)).toEqual([
      { type: "Point", coordinates: [0, 0] },
      { type: "Point", coordinates: [9, 9] },
    ]);
  });

  it("locks a polygon with a hole, and saves it back exactly as loaded", () => {
    const holed = { type: "Polygon" as const, coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 0]],
      [[2, 2], [3, 2], [3, 3], [2, 2]],
    ] };
    const session = prepareForEditing([feature(holed, { name: "Field" })]);
    expect(session.parts).toEqual([]);
    expect(session.locked.size).toBe(1);
    expect(assembleForSaving(session, [])).toEqual([{ type: "Feature", geometry: holed, properties: { name: "Field" } }]);
  });

  it("keeps a part terra-draw refused, alongside the parts it took", () => {
    const session = prepareForEditing([feature({ type: "MultiPoint", coordinates: [[0, 0], [1, 1]] }, { name: "Graves" })]);
    lockPart(session, session.parts[1].sourceKey);
    const [saved] = assembleForSaving(session, unchanged(session));
    expect(saved.geometry).toEqual({ type: "MultiPoint", coordinates: [[0, 0], [1, 1]] });
  });

  it("rounds coordinates to terra-draw's 9 decimal places", () => {
    const session = prepareForEditing([feature({ type: "Point", coordinates: [1.123456789123, 2.000000000049] })]);
    expect(session.parts[0].geometry).toEqual({ type: "Point", coordinates: [1.123456789, 2] });
  });
});
