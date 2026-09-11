import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, fetchPage: vi.fn() };
});
vi.mock("../objectsApi", () => ({ deleteObject: vi.fn() }));

import { fetchPage, type QueryItem } from "../api";
import { deleteObject } from "../objectsApi";
import { TOPIC_MESSAGES_VIEW } from "../views";
import {
  createTopic, deleteAllTopicMessages, fetchTopicMessages, openOrCreateUserTopic, parseTopicSpec,
  postTopicMessage, updateTopic, updateTopicMessage,
} from "../topicsApi";

function page(items: QueryItem[], nextAfter: string | null = null) {
  return { page: { items, next_after: nextAfter }, totalCount: items.length };
}

function mockFetch(responses: { ok: boolean; body: unknown }[]) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = responses.shift()!;
    return {
      ok: next.ok,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createTopic", () => {
  it("POSTs a private Note typed 'topic' with title-only JSON when no description is given", async () => {
    const fetchMock = mockFetch([{ ok: true, body: [{ type: "add", handle: "N1" }] }]);

    const handle = await createTopic("tok", "Smith family origins");

    expect(handle).toBe("N1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/notes/");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      text: { string: JSON.stringify({ title: "Smith family origins" }) },
      type: "topic",
      private: true,
    });
  });

  it("includes the description when given", async () => {
    mockFetch([{ ok: true, body: [{ type: "add", handle: "N1" }] }]);

    await createTopic("tok", "Smith family origins", "Where did they come from?");

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.parse((body.text as { string: string }).string)).toEqual({
      title: "Smith family origins",
      description: "Where did they come from?",
    });
  });

  it("includes participants when given, alongside a description", async () => {
    mockFetch([{ ok: true, body: [{ type: "add", handle: "N1" }] }]);

    await createTopic("tok", "Smith family origins", "Where did they come from?", ["alice", "bob"]);

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.parse((body.text as { string: string }).string)).toEqual({
      title: "Smith family origins",
      description: "Where did they come from?",
      participants: ["alice", "bob"],
    });
  });

  it("omits participants from the spec entirely when given an empty array -- DiscussButton.tsx always passes an array, never undefined", async () => {
    mockFetch([{ ok: true, body: [{ type: "add", handle: "N1" }] }]);

    await createTopic("tok", "Smith family origins", undefined, []);

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    // This is what openOrCreateUserTopic's own dedup fragment below relies
    // on: a no-description-no-participants spec is *exactly* {title: ...},
    // not {title: ..., participants: []}.
    expect(JSON.parse((body.text as { string: string }).string)).toEqual({ title: "Smith family origins" });
  });
});

describe("postTopicMessage", () => {
  it("POSTs a private Note typed 'topic-message', addressed to the topic on line 1", async () => {
    const fetchMock = mockFetch([{ ok: true, body: [{ type: "add", handle: "N2" }] }]);

    const handle = await postTopicMessage("tok", "N-TOPIC-1", "alice", "hello there");

    expect(handle).toBe("N2");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      text: { string: "N-TOPIC-1\nalice: hello there" },
      type: "topic-message",
      private: true,
    });
  });
});

describe("updateTopicMessage", () => {
  it("GETs the note, re-stamps the topic-handle/author/message text, and PUTs it back", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { handle: "N2", type: "topic-message", text: { string: "N-TOPIC-1\nalice: hello there" }, tag_list: ["T1"] } },
      { ok: true, body: {} },
    ]);

    await updateTopicMessage("tok", "N2", "N-TOPIC-1", "alice", "hello there, fixed");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putCall = fetchMock.mock.calls[1];
    expect((putCall[1] as RequestInit).method).toBe("PUT");
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.tag_list).toEqual(["T1"]); // untouched fields survive the GET-then-PUT round trip
    expect((body.text as { string: string }).string).toBe("N-TOPIC-1\nalice: hello there, fixed");
  });
});

describe("updateTopic", () => {
  it("GETs the note, replaces its text with the new spec, and PUTs it back", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { handle: "N1", type: "topic", text: { string: "old" }, tag_list: ["T1"] } },
      { ok: true, body: {} },
    ]);

    await updateTopic("tok", "N1", { title: "New title" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putCall = fetchMock.mock.calls[1];
    expect((putCall[1] as RequestInit).method).toBe("PUT");
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.tag_list).toEqual(["T1"]); // untouched fields survive the GET-then-PUT round trip
    expect(JSON.parse((body.text as { string: string }).string)).toEqual({ title: "New title" });
  });
});

describe("parseTopicSpec", () => {
  it("parses a valid TopicSpec", () => {
    expect(parseTopicSpec(JSON.stringify({ title: "Ancestors", description: "goal" }))).toEqual({
      title: "Ancestors",
      description: "goal",
    });
  });

  it("falls back to the raw (truncated) text as the title when it isn't valid JSON", () => {
    expect(parseTopicSpec("not json")).toEqual({ title: "not json" });
    expect(parseTopicSpec("x".repeat(90))).toEqual({ title: `${"x".repeat(80)}…` });
  });

  it("falls back to a placeholder for empty/missing text", () => {
    expect(parseTopicSpec(undefined)).toEqual({ title: "Untitled discussion" });
    expect(parseTopicSpec("")).toEqual({ title: "Untitled discussion" });
  });
});

describe("fetchTopicMessages", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
  });

  it("ANDs the topic-message baseFilter with an exact match on this topic's handle, oldest first", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([]));

    await fetchTopicMessages("tok", "N-TOPIC-1", 200);

    const call = vi.mocked(fetchPage).mock.calls[0];
    expect(call[4]).toBe("type.string == 'topic-message' and ('N-TOPIC-1\\n' in text.string)");
    expect(call[5]).toEqual([{ column: "change", direction: "desc" }]);
    expect(call[6]).toBe(200);
  });

  it("parses and re-sorts the pool oldest-first regardless of the server's own order", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([
      { handle: "N3", text: { string: "N-TOPIC-1\nbob: second" }, change: 200 },
      { handle: "N2", text: { string: "N-TOPIC-1\nalice: first" }, change: 100 },
    ]));

    const result = await fetchTopicMessages("tok", "N-TOPIC-1", 200);

    expect(result).toEqual([
      { handle: "N2", author: "alice", text: "first", change: 100 },
      { handle: "N3", author: "bob", text: "second", change: 200 },
    ]);
  });
});

describe("deleteAllTopicMessages", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(deleteObject).mockReset().mockResolvedValue(undefined);
  });

  it("deletes nothing when the discussion has no messages", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([]));

    await deleteAllTopicMessages("tok", "N-TOPIC-1");

    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes every message on a single page", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([{ handle: "M1" }, { handle: "M2" }]));

    await deleteAllTopicMessages("tok", "N-TOPIC-1");

    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenCalledWith("tok", TOPIC_MESSAGES_VIEW, "M1");
    expect(deleteObject).toHaveBeenCalledWith("tok", TOPIC_MESSAGES_VIEW, "M2");
  });

  it("pages through more than one batch -- a discussion with more messages than fit in one page still gets fully cleaned up", async () => {
    vi.mocked(fetchPage)
      .mockResolvedValueOnce(page([{ handle: "M1" }], "CURSOR-1"))
      .mockResolvedValueOnce(page([{ handle: "M2" }], null));

    await deleteAllTopicMessages("tok", "N-TOPIC-1");

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchPage).mock.calls[0][2]).toBeNull(); // first page: after=null
    expect(vi.mocked(fetchPage).mock.calls[1][2]).toBe("CURSOR-1"); // second page: after=first page's own cursor
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenCalledWith("tok", TOPIC_MESSAGES_VIEW, "M1");
    expect(deleteObject).toHaveBeenCalledWith("tok", TOPIC_MESSAGES_VIEW, "M2");
  });

  it("scopes the query to just this discussion's own messages, same baseFilter+handle match as fetchTopicMessages", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([]));

    await deleteAllTopicMessages("tok", "N-TOPIC-1");

    const call = vi.mocked(fetchPage).mock.calls[0];
    expect(call[4]).toBe("type.string == 'topic-message' and ('N-TOPIC-1\\n' in text.string)");
  });
});

describe("openOrCreateUserTopic", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
  });

  it("returns the existing 1:1 topic's handle when one is already found, without creating a new one", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([{ handle: "N-EXISTING" }]));
    const fetchMock = mockFetch([]);

    const handle = await openOrCreateUserTopic("tok", "bob", "alice");

    expect(handle).toBe("N-EXISTING");
    expect(fetchMock).not.toHaveBeenCalled();
    // Sorted so either party's click resolves to the same title/topic.
    const call = vi.mocked(fetchPage).mock.calls[0];
    expect(call[4]).toContain("alice & bob");
  });

  it("creates a new topic titled from both usernames (sorted) when none exists yet", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce(page([]));
    mockFetch([{ ok: true, body: [{ type: "add", handle: "N-NEW" }] }]);

    const handle = await openOrCreateUserTopic("tok", "bob", "alice");

    expect(handle).toBe("N-NEW");
    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.parse((body.text as { string: string }).string)).toEqual({ title: "alice & bob" });
  });
});
