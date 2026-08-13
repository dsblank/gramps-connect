import { describe, expect, it } from "vitest";
import { getSearchHelp } from "../searchHelp";
import { VIEWS } from "../views";

/** What this file can't check: that an example expression actually compiles.
 * The parser is gramps-object-query-language, which is Python and lives
 * server-side, so the examples were compile-checked against its
 * `compile_expr()` when written (all of them, one namespace per view's
 * `typeName`) and a change to one wants that repeating. What it *can*
 * check is that a view never grows a search box with no help behind it. */
describe("search help", () => {
  const searchable = VIEWS.filter((view) => view.searchable !== false);

  it("covers every view that has a search box", () => {
    const missing = searchable.filter((view) => !getSearchHelp(view)).map((view) => view.key);
    expect(missing).toEqual([]);
  });

  it("gives each view examples and fields of its own", () => {
    for (const view of searchable) {
      const help = getSearchHelp(view)!;
      expect(help.examples.length, view.key).toBeGreaterThan(0);
      expect(help.fields.length, view.key).toBeGreaterThan(0);
    }
  });

  it("never repeats an example within a view", () => {
    for (const view of searchable) {
      const exprs = getSearchHelp(view)!.examples.map((example) => example.expr);
      expect(new Set(exprs).size, view.key).toBe(exprs.length);
    }
  });

  // Both Messages and Output are a fixed filter over a table another view
  // also shows in full (see ViewConfig.baseFilter) -- a search there is
  // AND-ed onto that filter, not a search of the whole table, and the help
  // has to say so or the results look arbitrarily short.
  it("explains the scope of a view that only shows part of its table", () => {
    for (const view of searchable.filter((v) => v.baseFilter)) {
      expect(getSearchHelp(view)!.scopeNote, view.key).toBeTruthy();
    }
  });
});
