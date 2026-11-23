import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPage } = vi.hoisted(() => ({ fetchPage: vi.fn() }));
vi.mock("../store/api", () => ({ fetchPage }));

import { fetchMatchingHandles } from "../store/chartFilters";

beforeEach(() => {
  fetchPage.mockReset();
});

const page = (handles: string[], nextAfter: string | null = null) => ({
  page: { items: handles.map((handle) => ({ handle })), next_after: nextAfter },
  totalCount: null,
});

describe("fetchMatchingHandles", () => {
  it("asks only about the chart's people, 500 at a time, handles only", async () => {
    const handles = Array.from({ length: 1001 }, (_, i) => `h${i}`);
    fetchPage.mockImplementation(async (...args: unknown[]) => {
      const expr = args[4] as string;
      return page(["h0", "h1000"].filter((h) => expr.includes(`'${h}'`)));
    });
    const matched = await fetchMatchingHandles("tok", "private == True", handles);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    const [, , , count, expr, , limit, columns] = fetchPage.mock.calls[0];
    expect(count).toBe(false);
    expect((expr as string).startsWith("(private == True) and handle in ['h0', 'h1', ")).toBe(true);
    expect(limit).toBe(500);
    expect(columns).toEqual([]);
    // The last chunk is a single handle.
    expect(fetchPage.mock.calls[2][4]).toBe("(private == True) and handle == 'h1000'");
    expect([...matched].sort()).toEqual(["h0", "h1000"]);
  });

  it("follows paging within a chunk", async () => {
    fetchPage.mockResolvedValueOnce(page(["a"], "cursor")).mockResolvedValueOnce(page(["b"]));
    const matched = await fetchMatchingHandles("tok", "x", ["a", "b"]);
    expect(fetchPage.mock.calls[1][2]).toBe("cursor");
    expect([...matched]).toEqual(["a", "b"]);
  });

  it("passes a GOQL error through", async () => {
    fetchPage.mockImplementation(async () => {
      throw new Error("unknown field 'brith'");
    });
    await expect(fetchMatchingHandles("tok", "brith.date", ["a"])).rejects.toThrow("brith");
  });
});
