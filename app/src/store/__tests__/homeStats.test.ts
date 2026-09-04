import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, fetchPage: vi.fn() };
});
vi.mock("../cacheMeta", () => ({
  fetchServerState: vi.fn(),
}));
vi.mock("../objectDetail", async () => {
  const actual = await vi.importActual<typeof import("../objectDetail")>("../objectDetail");
  return { ...actual, fetchObjectExtended: vi.fn() };
});
vi.mock("../notesApi", async () => {
  const actual = await vi.importActual<typeof import("../notesApi")>("../notesApi");
  return { ...actual, getTagHandleCached: vi.fn() };
});

import { fetchPage, type QueryItem } from "../api";
import { fetchServerState } from "../cacheMeta";
import { fetchObjectExtended } from "../objectDetail";
import { getTagHandleCached } from "../notesApi";
import { fetchHomeCounts, fetchMessageBoards, fetchLatestStories, fetchRecentlyChanged, STAT_VIEWS, timeAgo } from "../homeStats";

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

  it("excludes message- and story-typed notes -- the Messages/Story panels already cover those", async () => {
    vi.mocked(fetchPage).mockImplementation(async () => page([]));

    await fetchRecentlyChanged("tok", 5);

    const noteCall = vi.mocked(fetchPage).mock.calls.find(([view]) => view.key === "note")!;
    expect(noteCall[4]).toBe("type.string != 'message' and type.string != 'story'");
  });
});

describe("fetchMessageBoards", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchObjectExtended).mockReset();
    vi.mocked(getTagHandleCached).mockReset();
    vi.mocked(getTagHandleCached).mockResolvedValue("TAG-DONE");
  });

  const fredBacklink = {
    person: [{ handle: "P1", gramps_id: "I0001", primary_name: { first_name: "Fred", surname_list: [{ surname: "Blank" }] } }],
  };
  const adaBacklink = {
    person: [{ handle: "P2", gramps_id: "I0002", primary_name: { first_name: "Ada", surname_list: [{ surname: "Lovelace" }] } }],
  };

  it("collapses every object's own messages down to just its newest", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([
      { handle: "N3", gramps_id: "N0003", author: "alice: latest on Fred", text: "alice: latest on Fred", change: 900 },
      { handle: "N2", gramps_id: "N0002", author: "bob: older on Fred", text: "bob: older on Fred", change: 800 },
      { handle: "N1", gramps_id: "N0001", author: "alice: about Ada", text: "alice: about Ada", change: 700 },
    ]));
    vi.mocked(fetchObjectExtended).mockImplementation(async (_token, _view, handle) => {
      const backlinks: Record<string, unknown> = { N3: fredBacklink, N2: fredBacklink, N1: adaBacklink };
      return { handle, tag_list: [], extended: { backlinks: backlinks[handle as string] } } as any;
    });

    const result = await fetchMessageBoards("tok", 5, 5);

    expect(result.messages).toEqual([
      {
        handle: "N3", grampsId: "N0003", author: "alice", message: "latest on Fred", changeUnix: 900,
        about: { viewKey: "person", handle: "P1", label: "[I0001] Fred Blank" },
      },
      {
        handle: "N1", grampsId: "N0001", author: "alice", message: "about Ada", changeUnix: 700,
        about: { viewKey: "person", handle: "P2", label: "[I0002] Ada Lovelace" },
      },
    ]);
    expect(result.todos).toEqual([]);
  });

  it("treats a message with no resolved backlink as an open ToDo, not a conversation", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([
      { handle: "N4", gramps_id: "N0004", author: "carol: standalone note", text: "carol: standalone note", change: 950 },
    ]));
    vi.mocked(fetchObjectExtended).mockResolvedValueOnce({ handle: "N4", tag_list: [], extended: { backlinks: {} } } as any);

    const result = await fetchMessageBoards("tok", 5, 5);

    expect(result.messages).toEqual([]);
    expect(result.todos).toEqual([
      { handle: "N4", grampsId: "N0004", author: "carol", message: "standalone note", changeUnix: 950 },
    ]);
  });

  it("drops an already-done standalone message from the ToDo panel", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([
      { handle: "N5", gramps_id: "N0005", author: "carol: done already", text: "carol: done already", change: 950 },
    ]));
    vi.mocked(fetchObjectExtended).mockResolvedValueOnce({ handle: "N5", tag_list: ["TAG-DONE"], extended: { backlinks: {} } } as any);

    const result = await fetchMessageBoards("tok", 5, 5);

    expect(result.todos).toEqual([]);
  });

  it("sends MESSAGES_VIEW's own baseFilter, sized off the larger of the two panel limits", async () => {
    // Regression coverage carried over from the old fetchLatestMessages
    // test -- fetchPage() sends exactly the where_expr it's given, with no
    // idea MESSAGES_VIEW carries a fixed baseFilter the way a ViewStore's
    // combinedFilter() would apply automatically.
    vi.mocked(fetchPage).mockResolvedValueOnce(page([]));

    await fetchMessageBoards("tok", 5, 8);

    const call = vi.mocked(fetchPage).mock.calls[0];
    expect(call[4]).toBe("type.string == 'message'");
    expect(call[6]).toBe(48); // Math.max(5, 8) * CANDIDATE_MULTIPLIER (6)
  });
});

describe("fetchLatestStories", () => {
  it("reads each note's title out of its JSON-stringified StorySpec", async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchPage).mockResolvedValueOnce(
      page([{ handle: "N2", gramps_id: "N0002", title: JSON.stringify({ title: "Ada's Early Years" }), change: 900 }])
    );

    const result = await fetchLatestStories("tok", 5);

    expect(result).toEqual([
      { handle: "N2", grampsId: "N0002", title: "Ada's Early Years", changeUnix: 900 },
    ]);
  });

  it("sends STORY_VIEW's own baseFilter -- same regression this function's fetchLatestMessages counterpart guards against", async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchPage).mockResolvedValueOnce(page([]));

    await fetchLatestStories("tok", 5);

    const call = vi.mocked(fetchPage).mock.calls[0];
    expect(call[4]).toBe("type.string == 'story'");
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
