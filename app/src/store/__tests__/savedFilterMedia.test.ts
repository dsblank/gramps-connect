import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("tok"),
}));

import { fetchSavedFilters } from "../savedFilterMedia";
import { createEmptyTree } from "../goqlFilterTree";

function stubFetch(items: { handle: string; body: string }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/query/")) {
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

describe("fetchSavedFilters", () => {
  it("parses every tagged Media object into a SavedFilter, with handle attached", async () => {
    const tree = createEmptyTree("Person");
    stubFetch([{ handle: "h1", body: JSON.stringify({ id: "f1", name: "My filter", namespace: "Person", tree }) }]);
    const result = await fetchSavedFilters();
    expect(result).toEqual([{ id: "f1", name: "My filter", namespace: "Person", tree, handle: "h1" }]);
  });

  it("skips an entry whose file content isn't a valid SavedFilter, rather than failing the whole fetch", async () => {
    const tree = createEmptyTree("Family");
    stubFetch([
      { handle: "h1", body: JSON.stringify({ id: "f1", name: "Good", namespace: "Family", tree }) },
      { handle: "h2", body: "not json" },
      { handle: "h3", body: JSON.stringify({ id: "f3", name: "No tree", namespace: "Family" }) },
    ]);
    const result = await fetchSavedFilters();
    expect(result.map((f) => f.id)).toEqual(["f1"]);
  });
});
