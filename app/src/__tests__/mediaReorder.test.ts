import { describe, expect, it, vi, beforeEach } from "vitest";

const store: { obj: Record<string, unknown>; puts: Record<string, unknown>[] } = { obj: {}, puts: [] };
vi.mock("../store/objectsApi", () => ({
  fetchPlainObject: vi.fn(async () => structuredClone(store.obj)),
  updateObject: vi.fn(async (_t: string, _v: unknown, _h: string, obj: Record<string, unknown>) => {
    store.puts.push(obj);
  }),
}));
vi.mock("../components/related/RefEditDialog", () => ({ EVENT_ROLE_OPTIONS: [] }));

import { moveRefListEntry } from "../store/refListApi";
import { moveItem } from "../components/RefPickerField";

const ref = (h: string, rect?: number[]) => ({ _class: "MediaRef", ref: h, ...(rect ? { rect } : {}) });
const view = { key: "person" } as never;

describe("moveItem", () => {
  it("moves up, down, and to the top", () => {
    expect(moveItem(["a", "b", "c"], 1, 0)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("ignores out-of-range moves", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 1, 2)).toBe(list);
  });
});

describe("moveRefListEntry", () => {
  beforeEach(() => {
    store.obj = { handle: "P1", media_list: [ref("a"), ref("b", [1, 2, 3, 4]), ref("c")] };
    store.puts = [];
  });

  it("moves an entry to the top in one PUT, keeping its region", async () => {
    await moveRefListEntry("tok", view, "P1", "media_list", 1, 0, "b");
    expect(store.puts).toHaveLength(1);
    expect(store.puts[0].media_list).toEqual([ref("b", [1, 2, 3, 4]), ref("a"), ref("c")]);
  });

  it("moves down past a non-adjacent index (place overlays skipped)", async () => {
    await moveRefListEntry("tok", view, "P1", "media_list", 0, 2, "a");
    expect(store.puts[0].media_list).toEqual([ref("b", [1, 2, 3, 4]), ref("c"), ref("a")]);
  });

  it("refuses when the list changed underneath", async () => {
    await expect(moveRefListEntry("tok", view, "P1", "media_list", 1, 0, "c")).rejects.toThrow();
    expect(store.puts).toHaveLength(0);
  });
});
