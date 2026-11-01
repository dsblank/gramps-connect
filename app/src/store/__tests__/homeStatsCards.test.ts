// Home's Recently visited and Bookmarks cards (homeStats.ts's
// fetchRecentlyVisited/fetchHomeBookmarks), over mocked stores.
import { beforeEach, describe, expect, it, vi } from "vitest";

const visits = vi.hoisted(() => ({ list: [] as { type: string; handle: string; at: number }[], forgotten: [] as unknown[] }));
vi.mock("../visitedHistory", () => ({
  getVisits: () => visits.list,
  forgetVisits: (gone: unknown[]) => visits.forgotten.push(...gone),
}));

const marks = vi.hoisted(() => ({ lists: {} as Record<string, string[]>, loads: 0 }));
vi.mock("../bookmarks", () => ({
  BOOKMARKABLE_TYPES: ["person", "family", "event", "place", "source", "citation", "repository", "media", "note"],
  getBookmarks: (type: string) => marks.lists[type] ?? [],
  loadBookmarks: async () => { marks.loads += 1; },
}));

/** Every record exists except handles starting with "GONE". */
const fetchObjectsByHandle = vi.fn(async (_token: string, _type: string, handles: string[]) =>
  new Map(handles.filter((h) => !h.startsWith("GONE"))
    .map((h) => [h, { handle: h, gramps_id: h.toUpperCase(), change: 500, title: `Title ${h}`, desc: `Desc ${h}` }])));
vi.mock("../objectsByHandle", () => ({ fetchObjectsByHandle: (...args: [string, string, string[]]) => fetchObjectsByHandle(...args) }));

const { fetchHomeBookmarks, fetchRecentlyVisited } = await import("../homeStats");

beforeEach(() => {
  visits.list = [];
  visits.forgotten = [];
  marks.lists = {};
  marks.loads = 0;
  fetchObjectsByHandle.mockClear();
});

describe("fetchRecentlyVisited", () => {
  it("lists the newest visits, labeled, with when each was visited", async () => {
    visits.list = [
      { type: "place", handle: "p1", at: 300 },
      { type: "source", handle: "s1", at: 200 },
      { type: "place", handle: "p2", at: 100 },
    ];
    const items = await fetchRecentlyVisited("tok", 2);
    expect(items.map((i) => [i.viewKey, i.handle, i.label, i.changeUnix])).toEqual([
      ["place", "p1", "Title p1", 300],
      ["source", "s1", "Title s1", 200],
    ]);
    // One request per type among the shown visits only.
    expect(fetchObjectsByHandle.mock.calls.map((c) => [c[1], c[2]])).toEqual([["place", ["p1"]], ["source", ["s1"]]]);
  });

  it("drops visits to records that are gone, and forgets them", async () => {
    visits.list = [{ type: "media", handle: "GONE1", at: 300 }, { type: "media", handle: "m1", at: 200 }];
    const items = await fetchRecentlyVisited("tok", 8);
    expect(items.map((i) => i.handle)).toEqual(["m1"]);
    expect(visits.forgotten).toEqual([{ type: "media", handle: "GONE1", at: 300 }]);
  });

  it("shows an empty card rather than failing", async () => {
    visits.list = [{ type: "place", handle: "p1", at: 1 }];
    fetchObjectsByHandle.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchRecentlyVisited("tok", 8)).toEqual([]);
    expect(visits.forgotten).toEqual([]);
  });
});

describe("fetchHomeBookmarks", () => {
  it("reloads the shared list and lists the types in the Bookmarks page order", async () => {
    marks.lists = { place: ["p1"], source: ["s1", "s2"] };
    const items = await fetchHomeBookmarks("tok", 8);
    expect(marks.loads).toBe(1);
    expect(items.map((i) => [i.viewKey, i.handle, i.changeUnix])).toEqual([
      ["place", "p1", 500], ["source", "s1", 500], ["source", "s2", 500],
    ]);
  });

  it("skips bookmarks to deleted records but still fills the card", async () => {
    marks.lists = { place: ["GONE1", "p1", "p2", "p3"] };
    const items = await fetchHomeBookmarks("tok", 3);
    expect(items.map((i) => i.handle)).toEqual(["p1", "p2", "p3"]);
  });
});
