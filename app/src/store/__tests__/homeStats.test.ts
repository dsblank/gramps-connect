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
import { fetchHomeCounts, fetchHomePerson, fetchRecentTopics, fetchLatestStories, fetchRecentlyChanged, timeAgo } from "../homeStats";

function page(items: QueryItem[]) {
  return { page: { items, next_after: null }, totalCount: items.length };
}

function mockFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body,
    text: async () => JSON.stringify(response.body),
  }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A /api/search/ hit, shaped like gramps-web-api's response. */
function hit(objectType: string, handle: string, change: number, object: Record<string, unknown>) {
  return { object_type: objectType, handle, object: { handle, change, ...object } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRecentlyChanged", () => {
  it("sends one /api/search/ request sorted by change, over-fetching", async () => {
    const fetchMock = mockFetch({ ok: true, body: [] });

    await fetchRecentlyChanged("tok", 10);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://x");
    expect(url.pathname).toBe("/api/search/");
    expect(url.searchParams.get("query")).toBe("*");
    expect(url.searchParams.get("sort")).toBe("-change");
    expect(url.searchParams.get("profile")).toBe("self");
    expect(Number(url.searchParams.get("pagesize"))).toBeGreaterThan(10);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("builds each type's everyday label from the raw object/profile", async () => {
    mockFetch({
      ok: true,
      body: [
        hit("person", "h1", 110, {
          gramps_id: "I1",
          primary_name: {
            first_name: "Ann",
            surname_list: [{ surname: "Maiden", primary: false }, { surname: "Smith", primary: true }],
          },
        }),
        hit("family", "h2", 109, {
          gramps_id: "F1",
          profile: { father: { name_given: "Bob", name_surname: "Smith" }, mother: { name_given: "Ann", name_surname: "Jones" } },
        }),
        hit("event", "h3", 108, { gramps_id: "E1", description: "", type: "Birth" }),
        hit("place", "h4", 107, { gramps_id: "P1", title: "", name: { value: "Springfield" } }),
        hit("citation", "h5", 106, { gramps_id: "C1", page: "p. 4", profile: { source: { title: "Census" } } }),
        hit("note", "h6", 105, { gramps_id: "N1", type: "General", text: { string: "Hello", tags: [] } }),
        hit("tag", "h7", 104, { name: "ToDo" }),
      ],
    });

    const items = await fetchRecentlyChanged("tok", 10);

    expect(items.map((i) => [i.viewKey, i.grampsId, i.label])).toEqual([
      ["person", "I1", "Ann Smith"],
      ["family", "F1", "Bob Smith & Ann Jones"],
      ["event", "E1", "Birth"],
      ["place", "P1", "Springfield"],
      ["citation", "C1", "Census, p. 4"],
      ["note", "N1", "Hello"],
      ["tag", "", "ToDo"],
    ]);
  });

  it("drops topic/story/topic-message notes (the Topics/Story panels cover those), unknown types, hits without an object or change timestamp, then caps at limit", async () => {
    mockFetch({
      ok: true,
      body: [
        hit("note", "t", 200, { gramps_id: "N1", type: "topic", text: { string: "{}" } }),
        hit("note", "s", 199, { gramps_id: "N2", type: "story", text: { string: "{}" } }),
        hit("note", "m", 198, { gramps_id: "N3", type: "topic-message", text: { string: "hi" } }),
        { object_type: "person", handle: "gone" },
        hit("unknown", "u", 197, {}),
        hit("source", "nochange", 0, { gramps_id: "S0", title: "No timestamp" }),
        hit("source", "a", 196, { gramps_id: "S1", title: "First" }),
        hit("source", "b", 195, { gramps_id: "S2", title: "Second" }),
        hit("source", "c", 194, { gramps_id: "S3", title: "Third" }),
      ],
    });

    const items = await fetchRecentlyChanged("tok", 2);

    expect(items.map((i) => i.handle)).toEqual(["a", "b"]);
  });

  it("resolves to an empty list rather than throwing when the search fails", async () => {
    mockFetch({ ok: false, status: 500, body: { error: { message: "boom" } } });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetchRecentlyChanged("tok", 10)).resolves.toEqual([]);
  });
});

describe("fetchRecentTopics", () => {
  it("reads each note's title out of its JSON-stringified TopicSpec", async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchPage).mockResolvedValueOnce(
      page([{ handle: "N2", gramps_id: "N0002", title: JSON.stringify({ title: "Smith family origins" }), change: 900 }])
    );

    const result = await fetchRecentTopics("tok", 5);

    expect(result).toEqual([
      { handle: "N2", grampsId: "N0002", title: "Smith family origins", changeUnix: 900 },
    ]);
  });

  it("sends TOPICS_VIEW's own baseFilter -- fetchPage() sends exactly the where_expr it's given, with no idea TOPICS_VIEW carries a fixed baseFilter the way a ViewStore's combinedFilter() would apply automatically", async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchPage).mockResolvedValueOnce(page([]));

    await fetchRecentTopics("tok", 5);

    const call = vi.mocked(fetchPage).mock.calls[0];
    expect(call[4]).toBe("type.string == 'topic'");
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

  it("sends STORY_VIEW's own baseFilter -- same regression this function's fetchRecentTopics counterpart guards against", async () => {
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

describe("fetchHomePerson", () => {
  it("GETs the person directly and maps it to personLabel's fields", async () => {
    const fetchMock = mockFetch({
      ok: true,
      body: { handle: "h1", gramps_id: "I7", primary_name: { first_name: "Eve", surname_list: [{ surname: "Doe" }] } },
    });

    const person = await fetchHomePerson("tok", "h1");

    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/people/h1?keys=handle,gramps_id,primary_name");
    expect(person).toEqual({ handle: "h1", gramps_id: "I7", given_name: "Eve", surname: "Doe" });
  });

  it("resolves to null on 404 (deleted, or private to this user)", async () => {
    mockFetch({ ok: false, status: 404, body: {} });

    await expect(fetchHomePerson("tok", "gone")).resolves.toBeNull();
  });
});
