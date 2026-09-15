import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("tok"),
}));

import { customRuleAsPreset, fetchCustomRules, type CustomRule } from "../customRuleMedia";

function stubFetch(items: { handle: string; body: string }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/query/")) {
        void init;
        return {
          ok: true,
          headers: new Headers(),
          json: () => Promise.resolve({ items: items.map((i) => ({ handle: i.handle })), next_after: null }),
        } as unknown as Response;
      }
      const match = items.find((i) => typeof url === "string" && url.includes(i.handle));
      if (!match) return { ok: false, status: 404, statusText: "Not Found", text: () => Promise.resolve("") } as unknown as Response;
      return { ok: true, text: () => Promise.resolve(match.body) } as unknown as Response;
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCustomRules", () => {
  it("parses every tagged Media object into a CustomRule, with handle attached", async () => {
    stubFetch([
      { handle: "h1", body: JSON.stringify({ id: "c1", name: "My rule", namespace: "Person", whereExpr: "gender == 1" }) },
    ]);
    const result = await fetchCustomRules();
    expect(result).toEqual([{ id: "c1", name: "My rule", namespace: "Person", whereExpr: "gender == 1", handle: "h1" }]);
  });

  it("skips an entry whose file content isn't a valid CustomRule, rather than failing the whole fetch", async () => {
    stubFetch([
      { handle: "h1", body: JSON.stringify({ id: "c1", name: "Good", namespace: "Person", whereExpr: "x" }) },
      { handle: "h2", body: "not json" },
      { handle: "h3", body: JSON.stringify({ id: "c3", namespace: "Person" }) }, // missing name/whereExpr
      {
        handle: "h4",
        body: JSON.stringify({
          id: "c4", name: "Bad param", namespace: "Person", whereExpr: "x",
          params: [{ name: "n", label: "N", type: "float" }], // "float" isn't a valid param type
        }),
      },
    ]);
    const result = await fetchCustomRules();
    expect(result.map((c) => c.id)).toEqual(["c1"]);
  });

  it("parses a rule with typed parameters, with handle attached", async () => {
    stubFetch([
      {
        handle: "h1",
        body: JSON.stringify({
          id: "c1", name: "Older than", namespace: "Person", whereExpr: "count(families) > {minCount}",
          params: [{ name: "minCount", label: "Minimum count", type: "integer" }],
        }),
      },
    ]);
    const result = await fetchCustomRules();
    expect(result).toEqual([
      {
        id: "c1", name: "Older than", namespace: "Person", whereExpr: "count(families) > {minCount}",
        params: [{ name: "minCount", label: "Minimum count", type: "integer" }],
        handle: "h1",
      },
    ]);
  });
});

describe("customRuleAsPreset", () => {
  it("adapts a CustomRule into the minimal shape the compiler/picker read", () => {
    const rule: CustomRule = { id: "c1", name: "Widowed young", namespace: "Family", whereExpr: "type == 3" };
    expect(customRuleAsPreset(rule)).toEqual({
      id: "c1",
      label: "Widowed young",
      category: "Custom",
      namespace: "Family",
      sourceRule: "",
      expr: "type == 3",
      params: undefined,
      supported: true,
    });
  });

  it("passes params through unchanged for a rule that has them", () => {
    const rule: CustomRule = {
      id: "c1", name: "Older than", namespace: "Person", whereExpr: "count(families) > {minCount}",
      params: [{ name: "minCount", label: "Minimum count", type: "integer" }],
    };
    expect(customRuleAsPreset(rule).params).toEqual([
      { name: "minCount", label: "Minimum count", type: "integer" },
    ]);
  });
});
