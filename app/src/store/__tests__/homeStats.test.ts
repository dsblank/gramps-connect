import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, fetchPage: vi.fn() };
});
vi.mock("../cacheMeta", () => ({
  fetchServerState: vi.fn(),
}));

import { fetchPage, type QueryItem } from "../api";
import { fetchServerState } from "../cacheMeta";
import { fetchHomeCounts, fetchLatestMessages, fetchRecentlyChanged, STAT_VIEWS, timeAgo } from "../homeStats";

function page(items: QueryItem[]) {
  return { page: { items, next_after: null }, totalCount: items.length };
}

describe("fetchRecentlyChanged", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
  });

  it("merges every type's own top rows into one newest-first list, capped at the limit", async () => {
    vi.mocked(fetchPage).mockImplementation(async (view) => {
      if (view.key === "person") {
        return page([{ handle: "P1", gramps_id: "I0001", given_name: "Ada", surname: "Lovelace", change: 300 }]);
      }
      if (view.key === "place") {
        return page([{ handle: "L1", gramps_id: "P0001", title: "London", change: 500 }]);
      }
      return page([]);
    });

    const result = await fetchRecentlyChanged("tok", 5);

    expect(result).toEqual([
      { viewKey: "place", handle: "L1", grampsId: "P0001", label: "London", changeUnix: 500 },
      { viewKey: "person", handle: "P1", grampsId: "I0001", label: "Ada Lovelace", changeUnix: 300 },
    ]);
    // One query per real object type (see STAT_VIEWS), each ordered by
    // change desc and capped to the same limit passed in.
    expect(vi.mocked(fetchPage)).toHaveBeenCalledTimes(STAT_VIEWS.length);
    const personCall = vi.mocked(fetchPage).mock.calls.find(([view]) => view.key === "person")!;
    expect(personCall[5]).toEqual([{ column: "change", direction: "desc" }]);
    expect(personCall[6]).toBe(5);
  });

  it("labels a Family from its resolved father/mother names, and drops rows with no change timestamp", async () => {
    vi.mocked(fetchPage).mockImplementation(async (view) => {
      if (view.key === "family") {
        return page([
          // Raw as the server sends it: father_name's json_path select
          // resolves to the whole Name struct, which cellText() then runs
          // through the column's own toSql (stringify) + toDisplay
          // (displayName) -- the same two steps ViewStore's insertPage/
          // DataTable would apply.
          { handle: "F1", gramps_id: "F0001", father_name: { first_name: "Bob", surname_list: [{ surname: "Smith" }] }, mother_name: null, change: 700 },
          { handle: "F2", gramps_id: "F0002", father_name: null, mother_name: null, change: null },
        ]);
      }
      return page([]);
    });

    const result = await fetchRecentlyChanged("tok", 5);

    expect(result).toEqual([{ viewKey: "family", handle: "F1", grampsId: "F0001", label: "Bob Smith", changeUnix: 700 }]);
  });

  it("treats a type this user can't query as contributing nothing, rather than failing the page", async () => {
    vi.mocked(fetchPage).mockImplementation(async (view) => {
      if (view.key === "note") throw new Error("403 forbidden");
      if (view.key === "tag") return page([{ handle: "T1", gramps_id: "", name: "Ancestors", change: 100 }]);
      return page([]);
    });

    const result = await fetchRecentlyChanged("tok", 5);

    expect(result).toEqual([{ viewKey: "tag", handle: "T1", grampsId: "", label: "Ancestors", changeUnix: 100 }]);
  });

  it("excludes message-tagged notes -- the Messages panel already covers those", async () => {
    vi.mocked(fetchPage).mockImplementation(async () => page([]));

    await fetchRecentlyChanged("tok", 5);

    const noteCall = vi.mocked(fetchPage).mock.calls.find(([view]) => view.key === "note")!;
    expect(noteCall[4]).toBe("not exists(tags, name == 'message')");
  });
});

describe("fetchLatestMessages", () => {
  it("splits each note's 'author: message' text into the two columns", async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchPage).mockResolvedValueOnce(
      page([{ handle: "N1", gramps_id: "N0001", author: "alice: Found the 1910 census", text: "alice: Found the 1910 census", change: 900 }])
    );

    const result = await fetchLatestMessages("tok", 5);

    expect(result).toEqual([
      { handle: "N1", grampsId: "N0001", author: "alice", message: "Found the 1910 census", changeUnix: 900 },
    ]);
  });

  it("sends MESSAGES_VIEW's own baseFilter -- regression test for a bug where it fetched every Note", async () => {
    // fetchPage() (api.ts) sends exactly the where_expr it's given; it has
    // no idea MESSAGES_VIEW carries a fixed baseFilter the way ViewStore's
    // combinedFilter() would apply automatically. A prior version of this
    // function passed `null` straight through and silently returned every
    // Note, tagged "message" or not.
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchPage).mockResolvedValueOnce(page([]));

    await fetchLatestMessages("tok", 5);

    const call = vi.mocked(fetchPage).mock.calls[0];
    expect(call[4]).toBe("exists(tags, name == 'message')");
  });
});

describe("fetchHomeCounts", () => {
  it("reads counts off cacheMeta's already-memoized server state", async () => {
    vi.mocked(fetchServerState).mockResolvedValue({
      dbName: "x", dbId: "y", cursor: null,
      counts: { person: 4668, family: 2855 },
    });

    expect(await fetchHomeCounts()).toEqual({ person: 4668, family: 2855 });
  });
});

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats a recent change in minutes", () => {
    const fifteenMinutesAgo = Math.floor(Date.now() / 1000) - 15 * 60;
    expect(timeAgo(fifteenMinutesAgo)).toBe("15 minutes ago");
  });

  it("formats an older change in months", () => {
    const aboutAMonthAgo = Math.floor(Date.now() / 1000) - 32 * 24 * 60 * 60;
    expect(timeAgo(aboutAMonthAgo)).toBe("last month");
  });

  it("returns empty for no timestamp at all", () => {
    expect(timeAgo(null)).toBe("");
    expect(timeAgo(undefined)).toBe("");
    expect(timeAgo(0)).toBe("");
  });
});
