import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchObjectHistory, objClassFor } from "../historyApi";
import type { ViewConfig } from "../views";

function view(key: string): ViewConfig {
  return { key } as ViewConfig;
}

describe("objClassFor", () => {
  it("maps known view keys to their Gramps class name", () => {
    expect(objClassFor(view("person"))).toBe("Person");
    expect(objClassFor(view("media"))).toBe("Media");
    expect(objClassFor(view("tag"))).toBe("Tag");
  });

  it("returns undefined for app-level constructs with no real object history", () => {
    expect(objClassFor(view("generated"))).toBeUndefined();
    expect(objClassFor(view("topics"))).toBeUndefined();
    expect(objClassFor(view("story"))).toBeUndefined();
  });
});

describe("fetchObjectHistory", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests old/new data and reads the total from X-Total-Count", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name === "X-Total-Count" ? "42" : null) },
      json: async () => [{ id: 1, trans_type: 1, timestamp: 123, obj_class: "Person", obj_handle: "H1", transaction_id: 9 }],
    });

    const result = await fetchObjectHistory("tok", "Person", "H1", { page: 1, pagesize: 10 });

    expect(result.count).toBe(42);
    expect(result.changes).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0];
    // No trailing slash before the query string -- gramps-web-api registers
    // this route without one (unlike the tree-wide /transactions/history/),
    // and Flask 404s a request that adds one instead of redirecting.
    expect(url).toContain("/api/transactions/history/objects/Person/H1?");
    expect(url).not.toContain("/H1/?");
    expect(url).toContain("old=true");
    expect(url).toContain("new=true");
    expect(url).toContain("page=1");
    expect(url).toContain("pagesize=10");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, headers: { get: () => null } });
    await expect(fetchObjectHistory("tok", "Person", "H1", { page: 1, pagesize: 10 })).rejects.toThrow("403");
  });
});
