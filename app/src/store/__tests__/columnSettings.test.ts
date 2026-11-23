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

  it("follows one entry of a collection like a link", () => {
    expect(expressionDependencies("Person", "parent_families[0].father.primary_name")).toEqual({
      links: [
        { select: "parent_family_list", table: "family" },
        { select: "parent_families[0].father_handle", table: "person" },
      ],
      untracked: false,
    });
    expect(expressionDependencies("Person", "families[0].children[0].birth.date").links).toEqual([
      { select: "family_list", table: "family" },
      { select: "families[0].child_ref_list", table: "person" },
      { select: "families[0].children[0].event_ref_list", table: "event" },
    ]);
    expect(expressionDependencies("Family", "father.parent_families[0].mother.surname").links).toEqual([
      { select: "father_handle", table: "person" },
      { select: "father.parent_family_list", table: "family" },
      { select: "father.parent_families[0].mother_handle", table: "person" },
    ]);
  });

  it("follows one entry of a list comprehension", () => {
    // A list on the record: nothing outside the row.
    expect(
      expressionDependencies("Person", "[a.value for a in attribute_list if a.type.value == AttributeType.OCCUPATION][0]"),
    ).toEqual({ links: [], untracked: false });
    // A collection: its list, then the chosen record's own links.
    expect(
      expressionDependencies("Person", "[f for f in parent_families if f.type.value == FamilyRelType.MARRIED][1].mother.primary_name"),
    ).toEqual({
      links: [
        { select: "parent_family_list", table: "family" },
        { select: "[f for f in parent_families if f.type.value == FamilyRelType.MARRIED][1].mother_handle", table: "person" },
      ],
      untracked: false,
    });
    // A link inside the condition isn't watched.
    const picked = expressionDependencies("Person", "[f.mother.surname for f in parent_families if f.father.surname == 'X'][0]");
    expect(picked.untracked).toBe(true);
    expect(picked.links).toEqual([
      { select: "parent_family_list", table: "family" },
      { select: "[f for f in parent_families if f.father.surname == 'X'][0].mother_handle", table: "person" },
    ]);
  });

  it("follows the links on both sides of arithmetic", () => {
    expect(expressionDependencies("Person", "(death.date.sortval - birth.date.sortval) // 365")).toEqual({
      links: [{ select: "event_ref_list", table: "event" }],
      untracked: false,
    });
    expect(expressionDependencies("Family", "mother.birth.date.dateval[2] - father.birth.date.dateval[2]").links).toEqual([
      { select: "mother_handle", table: "person" },
      { select: "mother.event_ref_list", table: "event" },
      { select: "father_handle", table: "person" },
      { select: "father.event_ref_list", table: "event" },
    ]);
  });

  it("needs nothing for the record's own fields and lists", () => {
    expect(expressionDependencies("Person", "primary_name.first_name")).toEqual({ links: [], untracked: false });
    expect(expressionDependencies("Person", "len(citations)")).toEqual({ links: [], untracked: false });
  });

  it("watches a collection's records through the list stored on the record", () => {
    expect(expressionDependencies("Person", "count(events, type.value == 12)")).toEqual({
      links: [{ select: "event_ref_list", table: "event" }], untracked: false,
    });
    expect(expressionDependencies("Person", "len([e for e in events if e.description == 'x'])")).toEqual({
      links: [{ select: "event_ref_list", table: "event" }], untracked: false,
    });
    expect(expressionDependencies("Family", "count(children, gender == 1)").links).toEqual([
      { select: "child_ref_list", table: "person" },
    ]);
    expect(expressionDependencies("Person", "count(child_refs, frel.value == 1)")).toEqual({
      links: [{ select: "parent_family_list", table: "family" }], untracked: false,
    });
  });

  it("watches the records a counted field or distinct count reads", () => {
    // f.father is the handle stored on each family: watching the families is enough.
    expect(expressionDependencies("Person", "len(distinct([f.father for f in parent_families]))")).toEqual({
      links: [{ select: "parent_family_list", table: "family" }], untracked: false,
    });
    expect(expressionDependencies("Person", "len([f.father for f in parent_families])")).toEqual({
      links: [{ select: "parent_family_list", table: "family" }], untracked: false,
    });
    // Reading on through the father reaches records that aren't watched.
    expect(
      expressionDependencies("Person", "len(distinct([f.father.primary_name.first_name for f in parent_families]))"),
    ).toEqual({ links: [{ select: "parent_family_list", table: "family" }], untracked: true });
  });

  it("flags what can't be watched", () => {
    expect(expressionDependencies("Person", "len(backlinks)").untracked).toBe(true);
    // The events are watched; their places aren't.
    expect(expressionDependencies("Person", 'count(events, place.title == "Chicago")')).toEqual({
      links: [{ select: "event_ref_list", table: "event" }], untracked: true,
    });
    expect(expressionDependencies("Person", "count(events, len(citations) > 0)").untracked).toBe(true);
  });

  it("ignores words inside strings", () => {
    expect(expressionDependencies("Person", 'count(citations, page == "birth.place")')).toEqual({
      links: [{ select: "citation_list", table: "citation" }], untracked: false,
    });
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
      "parent_families[0].father.primary_name", "families[0].children[0].birth.date",
    ]) {
      expect(structuredValueError("Person", expr)).toBeNull();
    }
    expect(structuredValueError("Event", "type")).toBeNull();
    expect(structuredValueError("Person", "death.date.dateval[2] - birth.date.dateval[2]")).toBeNull();
  });

  it("refuses a whole record, a list, or another structure, suggesting a value", () => {
    expect(structuredValueError("Person", "birth")).toMatch(/whole record.*birth\.gramps_id/);
    expect(structuredValueError("Person", "parent_families[0].father")).toMatch(/whole record/);
    expect(structuredValueError("Person", "[f for f in parent_families][0].father")).toMatch(/whole record/);
    expect(structuredValueError("Person", "[a for a in attribute_list if a.private][0]")).toMatch(/several values.*\]\[0\]\./);
    expect(structuredValueError("Person", "[a.value for a in attribute_list if a.private][0]")).toBeNull();
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

describe("sorting custom columns", () => {
  it("sorts a value by itself, a date by its sortval, a name by its parts, and not a type", async () => {
    const { customSortKeys } = await import("../columnSettings");
    const keys = (namespace: string, expr: string) => customSortKeys(namespace, expr)?.() ?? null;
    expect(keys("Person", "birth.place.title")).toEqual(["birth.place.title"]);
    expect(keys("Person", "len(citations)")).toEqual(["len(citations)"]);
    expect(keys("Person", "death.date.dateval[2] - birth.date.dateval[2]")).toEqual([
      "death.date.dateval[2] - birth.date.dateval[2]",
    ]);
    expect(keys("Person", "[a.value for a in attribute_list if a.private][0]")).toEqual([
      "[a.value for a in attribute_list if a.private][0]",
    ]);
    expect(keys("Person", "[f for f in parent_families][0].mother.primary_name")?.[0]).toMatch(
      /^\[f for f in parent_families\]\[0\]\.mother\.primary_name\./,
    );
    expect(keys("Person", "birth.date")).toEqual(["birth.date.sortval"]);
    // The default name format, "Surname, Given".
    expect(keys("Family", "father.primary_name")).toEqual([
      "father.primary_name.surname_list[0].surname", "father.primary_name.first_name",
    ]);
    expect(keys("Event", "type")).toBeNull();
    expect(keys("Person", "birth")).toBeNull();
  });

  it("sorts every custom column, a name by its parts and a value by itself, only on a small list", async () => {
    const { customColumnConfig } = await import("../columnSettings");
    const { columnSort } = await import("../columnSort");
    const name = customColumnConfig({ id: "goql_n", expr: "father.primary_name" });
    expect(columnSort(FAMILY_VIEW, name)).toEqual({
      keys: ["father.primary_name.surname_list[0].surname", "father.primary_name.first_name", "gramps_id"],
      limited: true,
    });
    const count = customColumnConfig({ id: "goql_a", expr: "len(citations)" });
    expect(columnSort(PERSON_VIEW, count)?.keys[0]).toBe("len(citations)");
    expect(columnSort(PERSON_VIEW, count)?.limited).toBe(true);
  });

  it("sorts a date by the sortval inside the cached date, at no refetch", async () => {
    const { layoutChangesCache } = await import("../columnSettings");
    localStorage.clear();
    resetViews();
    const { columnSort } = await import("../columnSort");
    const { locateSortKey } = await import("../columnSort");
    const layout = (title: string) => ({ custom: [{ id: "goql_b", expr: "birth.date", title }], order: [], hidden: [] });
    setColumnLayout("person", layout(""));
    applyColumnSettings(PERSON_VIEW);
    const visible = PERSON_VIEW.columns.find((c) => c.key === "goql_b")!;
    expect(columnSort(PERSON_VIEW, visible)?.keys[0]).toBe("birth.date.sortval");
    // Ranked from inside the built-in Birth column, which caches the same date.
    expect(locateSortKey(PERSON_VIEW, "birth.date.sortval")?.rest).toEqual(["sortval"]);
    // No hidden sort column (only birth's link-dependency ones).
    expect(PERSON_VIEW.columns.some((c) => c.key.startsWith("goql_b_") && !c.key.startsWith("goql_b_d"))).toBe(false);
    expect(layoutChangesCache(PERSON_VIEW, layout(""), layout("Born"))).toBe(false);
    resetViews();
  });
});

describe("a custom column's \"then by\"", () => {
  it("breaks ties by it before the list's default order", async () => {
    const { columnSort } = await import("../columnSort");
    const { customColumnConfig } = await import("../columnSettings");
    const column = customColumnConfig({ id: "goql_c", expr: "len(citations)", thenBy: "birth.date" });
    expect(columnSort(PERSON_VIEW, column)?.keys).toEqual(["len(citations)", "birth.date.sortval", "surname", "given_name"]);
  });

  it("reads it from a column that already selects it, with nothing new cached", async () => {
    const { layoutChangesCache } = await import("../columnSettings");
    const { locateSortKey } = await import("../columnSort");
    resetViews();
    const layout = (thenBy?: string) => ({ custom: [{ id: "goql_c", expr: "len(citations)", ...(thenBy ? { thenBy } : {}) }], order: [], hidden: [] });
    setColumnLayout("person", layout("birth.date"));
    applyColumnSettings(PERSON_VIEW);
    expect(PERSON_VIEW.columns.some((c) => c.key === "goql_c_t")).toBe(false);
    expect(locateSortKey(PERSON_VIEW, "birth.date.sortval")?.cached.key).toBe("birth_date");
    expect(layoutChangesCache(PERSON_VIEW, layout(), layout("birth.date"))).toBe(false);
    expect(layoutChangesCache(PERSON_VIEW, layout(), layout("gramps_id"))).toBe(false);
    resetViews();
  });

  it("caches one no column has, watching the records it reads", async () => {
    const { layoutChangesCache } = await import("../columnSettings");
    const { columnSort, locateSortKey } = await import("../columnSort");
    resetViews();
    const layout = (thenBy?: string) => ({ custom: [{ id: "goql_c", expr: "len(citations)", ...(thenBy ? { thenBy } : {}) }], order: [], hidden: [] });
    setColumnLayout("person", layout("birth.place.title"));
    applyColumnSettings(PERSON_VIEW);
    const hidden = PERSON_VIEW.columns.find((c) => c.key === "goql_c_t");
    expect(hidden).toMatchObject({ hidden: true, select: { goql: "birth.place.title" } });
    expect(locateSortKey(PERSON_VIEW, "birth.place.title")?.cached.key).toBe("goql_c_t");
    // Its link to the birth event, and the event's to the place, are watched.
    expect(PERSON_VIEW.dependsOn?.some((d) => d.via.startsWith("goql_c_t_d"))).toBe(true);
    const custom = PERSON_VIEW.columns.find((c) => c.key === "goql_c")!;
    expect(columnSort(PERSON_VIEW, custom)?.keys.slice(0, 2)).toEqual(["len(citations)", "birth.place.title"]);
    expect(layoutChangesCache(PERSON_VIEW, layout(), layout("birth.place.title"))).toBe(true);
    resetViews();
  });

  it("ignores a type, which can't be sorted", async () => {
    const { columnSort } = await import("../columnSort");
    const { customColumnConfig } = await import("../columnSettings");
    const column = customColumnConfig({ id: "goql_c", expr: "len(citations)", thenBy: "birth.type" });
    expect(columnSort(PERSON_VIEW, column)?.keys).toEqual(["len(citations)", "surname", "given_name"]);
  });
});
