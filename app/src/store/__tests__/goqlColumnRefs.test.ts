import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({ getTreeId: () => "tree-a" }));

class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}
vi.stubGlobal("localStorage", new FakeLocalStorage());

const { setColumnLayout, setTreeColumns } = await import("../columnSettings");
const {
  ColumnRefError, columnRefsToIds, columnRefsToTitles, expandColumnRefs, maskColumnRefs, openColumnRefAt, scanColumnRefs,
} = await import("../goqlColumnRefs");
const { combineFilters, FilterCombineError } = await import("../goqlFilterCombiner");

beforeEach(() => {
  localStorage.clear();
  setTreeColumns([
    { id: "goql_gc", view: "person", expr: "len(children)", title: "Grandchildren", handle: "h1" },
    { id: "goql_bp", view: "person", expr: "birth.place.title", title: "Birthplace", handle: "h2" },
  ]);
  setColumnLayout("person", { custom: [{ id: "goql_mine", expr: "len(notes)", title: "My notes" }], order: [], hidden: [] });
});

describe("scanColumnRefs", () => {
  it("finds names outside strings", () => {
    const { refs, error } = scanColumnRefs("`A b` > 1 and 'x`y`' in `C`");
    expect(error).toBeNull();
    expect(refs.map((r) => r.name)).toEqual(["A b", "C"]);
  });

  it("reports an unclosed backtick", () => {
    expect(scanColumnRefs("`Father").error).not.toBeNull();
  });
});

describe("expandColumnRefs", () => {
  it("swaps a name for its column's GOQL, in parentheses", () => {
    expect(expandColumnRefs("`grandchildren` > 5", "person")).toBe("(len(children)) > 5");
  });

  it("knows built-in columns, by label", () => {
    expect(expandColumnRefs("'Fred' in `Father`", "family")).toBe("'Fred' in (father.primary_name)");
  });

  it("reads on from a plain path without parentheses", () => {
    expect(expandColumnRefs("`Father`.first_name == 'Fred'", "family")).toBe("father.primary_name.first_name == 'Fred'");
    expect(expandColumnRefs("`Birth`.sortval > 0", "person")).toBe("birth.date.sortval > 0");
  });

  it("leaves text without backticks, and backticks inside strings, alone", () => {
    expect(expandColumnRefs("gender == 1", "person")).toBe("gender == 1");
    expect(expandColumnRefs("'`Birthplace`' in surname", "person")).toBe("'`Birthplace`' in surname");
  });

  it("finds a column by its id, as rules store it", () => {
    expect(expandColumnRefs("`goql_gc` > 5", "person")).toBe("(len(children)) > 5");
  });

  it("says when there's no such column", () => {
    expect(() => expandColumnRefs("`Nope` > 1", "person")).toThrow(ColumnRefError);
  });

  it("keeps browser-only columns out of shared rules", () => {
    expect(expandColumnRefs("`My notes` > 1", "person")).toBe("(len(notes)) > 1");
    expect(() => expandColumnRefs("`My notes` > 1", "person", { sharedOnly: true })).toThrow(/only in this browser/);
  });
});

describe("stored form", () => {
  it("stores ids and shows titles", () => {
    const stored = columnRefsToIds("`grandchildren` > 5 and `Father` == 1 and `Nope`", "person");
    expect(stored).toBe("`goql_gc` > 5 and `Father` == 1 and `Nope`");
    expect(columnRefsToTitles(stored, "person")).toBe("`Grandchildren` > 5 and `Father` == 1 and `Nope`");
  });

  it("follows a renamed column", () => {
    const stored = columnRefsToIds("`Grandchildren` > 5", "person");
    setTreeColumns([{ id: "goql_gc", view: "person", expr: "len(children)", title: "Kids", handle: "h1" }]);
    expect(columnRefsToTitles(stored, "person")).toBe("`Kids` > 5");
    expect(expandColumnRefs(stored, "person")).toBe("(len(children)) > 5");
  });
});

describe("completion helpers", () => {
  it("masks names without moving positions", () => {
    expect(maskColumnRefs("`Ab` > 1")).toBe("0000 > 1");
  });

  it("finds the name being typed", () => {
    expect(openColumnRefAt("x and `Gra", 10)).toBe(7);
    expect(openColumnRefAt("`A` and x", 9)).toBeNull();
    expect(openColumnRefAt("'`' and x", 9)).toBeNull();
  });
});

describe("in a Custom Rule", () => {
  const rule = (expr: string) => ({
    kind: "preset" as const,
    preset: { id: "r", label: "Big families", category: "Custom" as const, namespace: "Person" as const, sourceRule: "", expr, supported: true },
  });

  it("is swapped when the filter is combined, each time", () => {
    expect(combineFilters(rule("`goql_gc` > 5")).whereExpr).toBe("((len(children)) > 5)");
    setTreeColumns([{ id: "goql_gc", view: "person", expr: "len(child_ref_list)", handle: "h1" }]);
    expect(combineFilters(rule("`goql_gc` > 5")).whereExpr).toBe("((len(child_ref_list)) > 5)");
  });

  it("names the rule when a column is gone", () => {
    setTreeColumns([]);
    expect(() => combineFilters(rule("`goql_gc` > 5"))).toThrow(FilterCombineError);
    expect(() => combineFilters(rule("`goql_gc` > 5"))).toThrow(/Big families/);
  });
});
