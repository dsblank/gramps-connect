import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, fetchPage: vi.fn() };
});

import { fetchPage, type QueryItem } from "../api";
import { fetchDmConversation, fetchDmPool, fetchMyDmPool, groupDmConversations } from "../dmApi";
import { DM_VIEW } from "../views";
import { buildDmInvolvesExpr, buildDmPairExpr, formatDmText } from "../dmText";

function page(items: QueryItem[]) {
  return { page: { items, next_after: null }, totalCount: items.length };
}

describe("groupDmConversations", () => {
  it("buckets messages I sent and messages sent to me under the same partner", () => {
    const items: QueryItem[] = [
      { handle: "N1", text: formatDmText("bob", "alice", "hi bob"), change: 100 },
      { handle: "N2", text: formatDmText("alice", "bob", "hi back"), change: 200 },
    ];
    const result = groupDmConversations("alice", items);
    expect(Array.from(result.keys())).toEqual(["bob"]);
    expect(result.get("bob")).toEqual([
      { author: "alice", text: "hi bob", change: 100 },
      { author: "bob", text: "hi back", change: 200 },
    ]);
  });

  it("sorts each conversation oldest first regardless of pool order", () => {
    const items: QueryItem[] = [
      { handle: "N1", text: formatDmText("bob", "alice", "second"), change: 200 },
      { handle: "N2", text: formatDmText("alice", "bob", "first"), change: 100 },
    ];
    const result = groupDmConversations("alice", items);
    expect(result.get("bob")!.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("keeps separate conversations with different partners apart", () => {
    const items: QueryItem[] = [
      { handle: "N1", text: formatDmText("bob", "alice", "to bob"), change: 100 },
      { handle: "N2", text: formatDmText("carol", "alice", "to carol"), change: 200 },
    ];
    const result = groupDmConversations("alice", items);
    expect(Array.from(result.keys()).sort()).toEqual(["bob", "carol"]);
  });

  it("drops a row that involves neither the given user as author nor recipient", () => {
    const items: QueryItem[] = [{ handle: "N1", text: formatDmText("carol", "bob", "not mine"), change: 100 }];
    expect(groupDmConversations("alice", items).size).toBe(0);
  });

  it("drops a row where author and recipient are both me (can't happen via createDm, but shouldn't crash or self-bucket)", () => {
    const items: QueryItem[] = [{ handle: "N1", text: formatDmText("alice", "alice", "note to self"), change: 100 }];
    expect(groupDmConversations("alice", items).size).toBe(0);
  });

  it("drops a row with no resolvable 'to:' header instead of guessing a partner", () => {
    const items: QueryItem[] = [{ handle: "N1", text: "alice: not a DM", change: 100 }];
    expect(groupDmConversations("alice", items).size).toBe(0);
  });

  it("reads text delivered as a {string} object the same as a plain string", () => {
    const items: QueryItem[] = [
      { handle: "N1", text: { string: formatDmText("bob", "alice", "hi") } as unknown as string, change: 100 },
    ];
    expect(groupDmConversations("alice", items).get("bob")).toEqual([{ author: "alice", text: "hi", change: 100 }]);
  });
});

describe("fetchDmPool", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
  });

  it("queries DM_VIEW's own baseFilter, newest first", async () => {
    vi.mocked(fetchPage).mockResolvedValue(page([{ handle: "N1", change: 100 }]));

    const items = await fetchDmPool("tok", 50);

    expect(items).toEqual([{ handle: "N1", change: 100 }]);
    expect(fetchPage).toHaveBeenCalledWith(
      DM_VIEW, "tok", null, false, DM_VIEW.baseFilter, [{ column: "change", direction: "desc" }], 50
    );
  });

  it("ANDs an extraFilter onto DM_VIEW's baseFilter when given", async () => {
    vi.mocked(fetchPage).mockResolvedValue(page([]));

    await fetchDmPool("tok", 50, "some_expr");

    expect(fetchPage).toHaveBeenCalledWith(
      DM_VIEW, "tok", null, false, `${DM_VIEW.baseFilter} and (some_expr)`,
      [{ column: "change", direction: "desc" }], 50
    );
  });
});

describe("fetchDmConversation", () => {
  it("scopes the query to the given pair via buildDmPairExpr", async () => {
    vi.mocked(fetchPage).mockReset().mockResolvedValue(page([]));

    await fetchDmConversation("tok", "alice", "bob", 50);

    expect(fetchPage).toHaveBeenCalledWith(
      DM_VIEW, "tok", null, false, `${DM_VIEW.baseFilter} and (${buildDmPairExpr("alice", "bob")})`,
      [{ column: "change", direction: "desc" }], 50
    );
  });
});

describe("fetchMyDmPool", () => {
  it("scopes the query to the given user via buildDmInvolvesExpr", async () => {
    vi.mocked(fetchPage).mockReset().mockResolvedValue(page([]));

    await fetchMyDmPool("tok", "alice", 50);

    expect(fetchPage).toHaveBeenCalledWith(
      DM_VIEW, "tok", null, false, `${DM_VIEW.baseFilter} and (${buildDmInvolvesExpr("alice")})`,
      [{ column: "change", direction: "desc" }], 50
    );
  });
});
