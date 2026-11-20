import { beforeEach, describe, expect, it, vi } from "vitest";

let treeId = "tree-a";
vi.mock("../../auth/auth", () => ({ getTreeId: () => treeId }));

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

const {
  applyColumnSettings, builtinColumns, clearBroken, expressionDependencies, formatGoqlValue, getColumnLayout,
  layoutColumns, markBroken, setColumnLayout, structuredValueError,
} = await import("../columnSettings");
const { PERSON_VIEW, FAMILY_VIEW } = await import("../views");
const { toRowValues } = await import("../sql");

// The views are module singletons: each test starts them from built-ins.
function resetViews() {
  for (const view of [PERSON_VIEW, FAMILY_VIEW]) {
    setColumnLayout(view.key, null);
    clearBroken(view.key);
    applyColumnSettings(view);
  }
}

describe("column layouts", () => {
  beforeEach(() => {
    treeId = "tree-a";
    resetViews();
    localStorage.clear();
  });

  it("is kept per tree", () => {
    setColumnLayout("person", { custom: [{ id: "goql_a", expr: "len(citations)" }], order: [], hidden: [] });
    expect(getColumnLayout("person").custom).toHaveLength(1);
    treeId = "tree-b";
    expect(getColumnLayout("person").custom).toHaveLength(0);
  });

  it("resets to the built-in columns with null", () => {
    setColumnLayout("person", { custom: [{ id: "goql_a", expr: "len(citations)" }], order: [], hidden: [] });
    setColumnLayout("person", null);
    expect(getColumnLayout("person")).toEqual({ custom: [], order: [], hidden: [] });
  });
});

describe("applyColumnSettings", () => {
  beforeEach(() => {
    treeId = "tree-a";
    localStorage.clear();
    resetViews();
  });

  it("appends custom columns as goql selects, and reports a cache change", () => {
    const base = builtinColumns(PERSON_VIEW).length;
    setColumnLayout("person", { custom: [{ id: "goql_a", expr: "len(citations)", title: "Citations" }], order: [], hidden: [] });
    expect(applyColumnSettings(PERSON_VIEW)).toBe(true);
    expect(PERSON_VIEW.columns).toHaveLength(base + 1);
    expect(PERSON_VIEW.columns[base]).toMatchObject({ key: "goql_a", label: "Citations", select: { goql: "len(citations)" } });
  });

  it("marks custom labels as literal, so t() can't drop an underscore", () => {
    setColumnLayout("person", { custom: [{ id: "goql_a", expr: "primary_name.nick", title: "nick_name" }], order: [], hidden: [] });
    applyColumnSettings(PERSON_VIEW);
    expect(PERSON_VIEW.columns.find((c) => c.key === "goql_a")).toMatchObject({ label: "nick_name", literalLabel: true });
  });

  it("doesn't count a title change as a cache change", () => {
    setColumnLayout("person", { custom: [{ id: "goql_a", expr: "len(citations)" }], order: [], hidden: [] });
    applyColumnSettings(PERSON_VIEW);
    setColumnLayout("person", { custom: [{ id: "goql_a", expr: "len(citations)", title: "Sources" }], order: [], hidden: [] });
    expect(applyColumnSettings(PERSON_VIEW)).toBe(false);
    expect(PERSON_VIEW.columns.find((c) => c.key === "goql_a")?.label).toBe("Sources");
  });

  it("leaves out a column marked broken", () => {
    setColumnLayout("person", { custom: [{ id: "goql_a", expr: "nope" }], order: [], hidden: [] });
    applyColumnSettings(PERSON_VIEW);
    markBroken("person", "goql_a", "unknown field");
    expect(applyColumnSettings(PERSON_VIEW)).toBe(true);
    expect(PERSON_VIEW.columns.some((c) => c.key === "goql_a")).toBe(false);
  });

  it("caches link handles and depends on the linked tables", () => {
    setColumnLayout("person", { custom: [{ id: "goql_a", expr: "birth.place.title" }], order: [], hidden: [] });
    applyColumnSettings(PERSON_VIEW);
    const deps = PERSON_VIEW.columns.filter((c) => c.key.startsWith("goql_a_d"));
    expect(deps.map((c) => c.select)).toEqual([{ goql: "event_ref_list" }, { goql: "birth.place" }]);
    expect(deps.every((c) => c.hidden)).toBe(true);
    expect(PERSON_VIEW.dependsOn).toEqual(
      expect.arrayContaining([{ table: "event", via: "goql_a_d0" }, { table: "place", via: "goql_a_d1" }]),
    );
    // The handles are stored comma-joined, as refreshDependents matches.
    const values = toRowValues(PERSON_VIEW, {
      handle: "h1",
      goql_a: "Boston",
      goql_a_d0: [{ ref: "e1" }, { ref: "e2" }],
      goql_a_d1: "p1",
    });
    expect(values.slice(-3)).toEqual(['"Boston"', "e1,e2", "p1"]);
  });

  it("restores the built-in dependsOn when custom columns go", () => {
    const original = builtinColumns(FAMILY_VIEW) && FAMILY_VIEW.dependsOn;
    setColumnLayout("family", { custom: [{ id: "goql_b", expr: "father.birth.date" }], order: [], hidden: [] });
    applyColumnSettings(FAMILY_VIEW);
    expect(FAMILY_VIEW.dependsOn!.length).toBeGreaterThan(original!.length);
    setColumnLayout("family", null);
    applyColumnSettings(FAMILY_VIEW);
    expect(FAMILY_VIEW.dependsOn).toEqual(original);
  });
});

describe("expressionDependencies", () => {
  it("follows each link a path crosses", () => {
    expect(expressionDependencies("Family", "father.birth.date").links).toEqual([
      { select: "father_handle", table: "person" },
      { select: "father.event_ref_list", table: "event" },
    ]);
    expect(expressionDependencies("Citation", "source.title").links).toEqual([{ select: "source_handle", table: "source" }]);
  });

  it("needs nothing for the record's own fields and lists", () => {
    expect(expressionDependencies("Person", "primary_name.first_name")).toEqual({ links: [], untracked: false });
    expect(expressionDependencies("Person", "len(citations)")).toEqual({ links: [], untracked: false });
  });

  it("flags what can't be watched", () => {
    expect(expressionDependencies("Person", "len(backlinks)").untracked).toBe(true);
    expect(expressionDependencies("Person", "count(events, type.value == 12)").untracked).toBe(true);
  });

  it("ignores words inside strings", () => {
    expect(expressionDependencies("Person", 'count(citations, page == "birth.place")').links).toEqual([]);
  });
});

describe("layoutColumns", () => {
  beforeEach(() => {
    treeId = "tree-a";
    localStorage.clear();
    resetViews();
  });

  it("orders and hides by the layout, keeping indexes into view.columns", () => {
    setColumnLayout("person", { custom: [], order: ["change", "gramps_id"], hidden: ["death_date"] });
    const shown = layoutColumns(PERSON_VIEW);
    expect(shown.slice(0, 2).map(({ column }) => column.key)).toEqual(["change", "gramps_id"]);
    expect(shown.some(({ column }) => column.key === "death_date")).toBe(false);
    for (const { column, index } of shown) expect(PERSON_VIEW.columns[index]).toBe(column);
  });

  it("never shows views.ts's own hidden columns, and never nothing", () => {
    const keys = builtinColumns(PERSON_VIEW).map((c) => c.key);
    setColumnLayout("person", { custom: [], order: [], hidden: keys });
    expect(layoutColumns(PERSON_VIEW)).toHaveLength(1);
    setColumnLayout("person", null);
    expect(layoutColumns(PERSON_VIEW).some(({ column }) => column.key === "surname")).toBe(false);
  });
});

describe("formatGoqlValue", () => {
  it("shows plain values as they are", () => {
    expect(formatGoqlValue("3")).toBe("3");
    expect(formatGoqlValue('"Boston"')).toBe("Boston");
    expect(formatGoqlValue(null)).toBe("");
    expect(formatGoqlValue("true")).toBe("✓");
  });

  it("names Gramps types", () => {
    expect(formatGoqlValue(JSON.stringify({ _class: "EventType", value: 12, string: "" }))).toBe("Birth");
    expect(formatGoqlValue(JSON.stringify({ _class: "EventType", value: 0, string: "Voyage" }))).toBe("Voyage");
  });

  it("shows a .change path like the Last changed column", async () => {
    const { customColumnConfig } = await import("../columnSettings");
    const { formatChange, formatChangeTitle } = await import("../views");
    const stamp = 1700000000;
    const column = customColumnConfig({ id: "goql_c", expr: "birth.place.change" });
    expect(column.toDisplay!(column.toSql!(stamp))).toBe(formatChange(stamp));
    expect(column.toTitle!(column.toSql!(stamp))).toBe(formatChangeTitle(stamp));
    expect(customColumnConfig({ id: "goql_d", expr: "exchange_rate" }).toTitle).toBeUndefined();
  });

  it("never shows raw JSON", () => {
    expect(formatGoqlValue(JSON.stringify({ _class: "Url", path: "x" }))).toBe("");
    expect(formatGoqlValue('["a","b"]')).toBe("");
  });
});

describe("structuredValueError", () => {
  it("allows single values, and the structures with a readable form", () => {
    for (const expr of [
      "gramps_id", "gender", "primary_name.first_name", "primary_name.surname_list[0].surname",
      "birth.place.title", "birth.date", "primary_name", "len(citations)", "count(events, type.value == 12)",
    ]) {
      expect(structuredValueError("Person", expr)).toBeNull();
    }
    expect(structuredValueError("Event", "type")).toBeNull();
  });

  it("refuses a whole record, a list, or another structure, suggesting a value", () => {
    expect(structuredValueError("Person", "birth")).toMatch(/whole record.*birth\.gramps_id/);
    expect(structuredValueError("Person", "tag_list")).toMatch(/list.*len\(tag_list\)/);
    expect(structuredValueError("Person", "primary_name.surname_list")).toMatch(/list/);
    expect(structuredValueError("Person", "address_list[0]")).toMatch(/several values.*address_list\[0\]\./);
  });

  it("leaves paths the vocabulary doesn't know to the server", () => {
    expect(structuredValueError("Person", "no_such_field")).toBeNull();
  });
});

describe("applyColumnSettings and structured values", () => {
  beforeEach(() => {
    localStorage.clear();
    resetViews();
  });

  it("leaves out a saved column that would show JSON", () => {
    setColumnLayout("person", { custom: [{ id: "goql_s", expr: "tag_list" }], order: [], hidden: [] });
    applyColumnSettings(PERSON_VIEW);
    expect(PERSON_VIEW.columns.some((c) => c.key === "goql_s")).toBe(false);
  });
});
