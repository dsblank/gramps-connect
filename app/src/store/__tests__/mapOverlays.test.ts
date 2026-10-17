import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("../api", () => ({ fetchPage: vi.fn() }));
vi.mock("../jobsApi", () => ({
  uploadMedia: vi.fn(), getOrCreateTagHandle: vi.fn(), tagAndDescribeMedia: vi.fn(), uploadMediaFileDetailed: vi.fn(),
}));
vi.mock("../kmlMedia", () => ({ fetchAllKmlFeatures: vi.fn(), fetchAllKmlImageOverlays: vi.fn() }));
vi.mock("../objectDetail", () => ({ fetchObjectExtended: vi.fn(), getBacklinks: vi.fn() }));
vi.mock("../refListApi", () => ({ attachRefListEntry: vi.fn() }));
vi.mock("../registry", () => ({ getViewStore: () => ({ requeryDebounced: vi.fn() }) }));
vi.mock("../views", () => ({ MEDIA_VIEW: { key: "media" }, PLACE_VIEW: { key: "place" }, TAG_VIEW: { key: "tag" } }));

import { getOrCreateTagHandle, tagAndDescribeMedia, uploadMedia, uploadMediaFileDetailed } from "../jobsApi";
import { fetchAllKmlFeatures, fetchAllKmlImageOverlays } from "../kmlMedia";
import { attachRefListEntry } from "../refListApi";
import { addMapFilesToPlace, isOverlay, makeOverlayFromMedia, overlayWhereExpr } from "../mapOverlays";

const track = {
  type: "Feature" as const,
  geometry: { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] },
  properties: { name: "Walk", _gpxType: "trk", coordinateProperties: { times: ["a", "b"] } },
};

const attachedTo = () => vi.mocked(attachRefListEntry).mock.calls.map((c) => [c[2], (c[4] as { ref: string }).ref]);

beforeEach(() => {
  vi.mocked(uploadMedia).mockReset().mockResolvedValue("overlay1");
  vi.mocked(getOrCreateTagHandle).mockReset().mockResolvedValue("tagOverlay");
  vi.mocked(tagAndDescribeMedia).mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchAllKmlFeatures).mockReset().mockResolvedValue([track]);
  vi.mocked(fetchAllKmlImageOverlays).mockReset().mockResolvedValue([]);
  vi.mocked(attachRefListEntry).mockReset().mockResolvedValue(undefined as any);
});

describe("isOverlay", () => {
  it("needs both the GeoJSON type and the overlay tag", () => {
    expect(isOverlay({ mime: "application/geo+json", tag_list: ["t1"] }, "t1")).toBe(true);
    expect(isOverlay({ mime: "application/geo+json", tag_list: [] }, "t1")).toBe(false);
    expect(isOverlay({ mime: "application/gpx+xml", tag_list: ["t1"] }, "t1")).toBe(false);
    expect(isOverlay({ mime: "application/geo+json", tag_list: ["t1"] }, null)).toBe(false);
  });

  it("has a matching where_expr for pickers", () => {
    expect(overlayWhereExpr()).toBe('mime == "application/geo+json" and any(t.name == "Map overlay" for t in tags)');
  });
});

describe("makeOverlayFromMedia", () => {
  it("writes a new tagged GeoJSON overlay from the file, attached to the given places", async () => {
    expect(await makeOverlayFromMedia("tok", "gpx1", "walk.gpx", ["p1", "p2"])).toBe("overlay1");
    const [, blob, mime] = vi.mocked(uploadMedia).mock.calls[0];
    expect(mime).toBe("application/geo+json");
    expect(JSON.parse(await (blob as Blob).text())).toEqual({
      type: "FeatureCollection",
      "gramps:source": "gpx1",
      features: [{ ...track, properties: { name: "Walk", coordinateProperties: { times: ["a", "b"] } } }],
    });
    expect(tagAndDescribeMedia).toHaveBeenCalledWith("tok", "overlay1", "walk", "tagOverlay");
    expect(attachedTo()).toEqual([["p1", "overlay1"], ["p2", "overlay1"]]);
  });

  it("makes nothing from a file with nothing to draw", async () => {
    vi.mocked(fetchAllKmlFeatures).mockResolvedValue([]);
    expect(await makeOverlayFromMedia("tok", "doc1", "notes.kml", ["p1"])).toBeNull();
    expect(uploadMedia).not.toHaveBeenCalled();
  });
});

describe("addMapFilesToPlace", () => {
  it("attaches the original as uploaded and an overlay made from it", async () => {
    vi.mocked(uploadMediaFileDetailed).mockReset().mockResolvedValue({ handle: "gpx1", mime: "application/gpx+xml" });
    const result = await addMapFilesToPlace("p1", [new File(["<gpx/>"], "walk.gpx")]);
    expect(result).toEqual({ overlays: 1, empty: [], failed: [] });
    expect(attachedTo()).toEqual([["p1", "gpx1"], ["p1", "overlay1"]]);
  });

  it("reports a file with nothing to draw, and one that failed, without stopping", async () => {
    vi.mocked(uploadMediaFileDetailed).mockReset()
      .mockRejectedValueOnce(new Error("quota exceeded"))
      .mockResolvedValueOnce({ handle: "kml1", mime: "application/vnd.google-earth.kml+xml" });
    vi.mocked(fetchAllKmlFeatures).mockResolvedValue([]);
    const result = await addMapFilesToPlace("p1", [new File(["x"], "a.gpx"), new File(["y"], "b.kml")]);
    expect(result).toEqual({ overlays: 0, empty: ["b.kml"], failed: [{ name: "a.gpx", message: "quota exceeded" }] });
    expect(attachedTo()).toEqual([["p1", "kml1"]]);
  });
});
