import { describe, expect, it, vi } from "vitest";
import { fetchSearch } from "../searchApi";

function mockFetch(hits: unknown[], total: number) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok: true,
        headers: { get: (name: string) => (name === "X-Total-Count" ? String(total) : null) },
        json: async () => hits,
      }) as unknown as Response
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchSearch", () => {
  it("always forces semantic=false and profile=all, and omits type/sort", async () => {
    const fetchMock = mockFetch([], 0);
    await fetchSearch("test-token", "smith", 1, 20);
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://localhost");
    expect(url.pathname).toBe("/api/search/");
    expect(url.searchParams.get("query")).toBe("smith");
    expect(url.searchParams.get("semantic")).toBe("false");
    expect(url.searchParams.get("profile")).toBe("all");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pagesize")).toBe("20");
    expect(url.searchParams.has("type")).toBe(false);
    expect(url.searchParams.has("sort")).toBe(false);
  });

  it("sends type only when a filter is given, for the SearchView type tabs", async () => {
    const fetchMock = mockFetch([], 0);
    await fetchSearch("test-token", "smith", 1, 20, "person");
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://localhost");
    expect(url.searchParams.get("type")).toBe("person");

    await fetchSearch("test-token", "smith", 1, 20, null);
    const url2 = new URL(fetchMock.mock.calls[1][0] as string, "http://localhost");
    expect(url2.searchParams.has("type")).toBe(false);
  });

  it("sends the bearer token", async () => {
    const fetchMock = mockFetch([], 0);
    await fetchSearch("test-token", "smith", 1, 20);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("parses hits and X-Total-Count", async () => {
    const hit = { handle: "abc", object_type: "person", object: { gramps_id: "I0001" }, score: 1.2 };
    mockFetch([hit], 42);
    const { hits, total } = await fetchSearch("test-token", "smith", 2, 20);
    expect(hits).toEqual([hit]);
    expect(total).toBe(42);
  });

  it("defaults total to 0 when the header is missing", async () => {
    mockFetch([], NaN);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({ ok: true, headers: { get: () => null }, json: async () => [] }) as unknown as Response
      )
    );
    const { total } = await fetchSearch("test-token", "smith", 1, 20);
    expect(total).toBe(0);
  });

  it("throws the parsed error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            text: async () => JSON.stringify({ error: { message: "search index not available" } }),
          }) as unknown as Response
      )
    );
    await expect(fetchSearch("test-token", "smith", 1, 20)).rejects.toThrow(
      "search index not available"
    );
  });
});
