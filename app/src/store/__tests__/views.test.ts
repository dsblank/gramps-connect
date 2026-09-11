import { describe, expect, it } from "vitest";
import { GENERATED_VIEW, STORY_VIEW, TOPICS_VIEW, visibleColumns } from "../views";

// Output/Discussions/Stories are each identified by their own description
// or title, not a Gramps ID no one assigned them for any reason of their
// own -- hidden: true keeps the column selected/cached/searchable (each
// view's own simpleSearch still matches against it) without cluttering
// the table with an identifier nobody reads.
describe.each([
  ["Output", GENERATED_VIEW],
  ["Discussions", TOPICS_VIEW],
  ["Stories", STORY_VIEW],
])("%s view", (_label, view) => {
  it("carries a gramps_id column (still cached/searchable) but hides it from the table", () => {
    const grampsIdColumn = view.columns.find((c) => c.key === "gramps_id");
    expect(grampsIdColumn?.hidden).toBe(true);
    expect(visibleColumns(view).some(({ column }) => column.key === "gramps_id")).toBe(false);
  });

  it("still searches gramps_id via the simple-search box, hidden column or not", () => {
    expect(view.simpleSearch?.buildExpr("I0001")).toContain("gramps_id");
  });
});
