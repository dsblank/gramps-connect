import { describe, expect, it } from "vitest";

import { gqlFilterPresets } from "../../data/gqlFilterPresets";
import { contextPresets, handleListExpr, type PresetContext } from "../contextPresets";
import { FilterCombineError } from "../goqlFilterCombiner";
import { combineFilterTree, type FilterTree } from "../goqlFilterTree";
import type { SavedFilter } from "../savedFilterMedia";

function tree(namespace: FilterTree["namespace"], presetIds: string[], connector: "and" | "or" = "and"): FilterTree {
  return {
    namespace,
    root: {
      kind: "rule-group", id: "root", connector, negate: false,
      children: presetIds.map((presetId, i) => ({ kind: "rule", id: `r${i}`, presetId, negate: false })),
    },
  };
}

function saved(id: string, name: string, presetIds: string[], namespace: FilterTree["namespace"] = "Person"): SavedFilter {
  return { id, name, namespace, tree: tree(namespace, presetIds) };
}

const context = (over: Partial<PresetContext> = {}): PresetContext => ({
  bookmarks: (ns) => (ns === "Person" ? ["H1", "H2"] : ns === "Family" ? ["F1"] : []),
  homePersonHandle: "HOME",
  savedFilters: [],
  ...over,
});

function compile(presetIds: string[], ctx: PresetContext, namespace: FilterTree["namespace"] = "Person"): string {
  const presets = [...gqlFilterPresets, ...contextPresets(gqlFilterPresets, ctx)];
  return combineFilterTree(tree(namespace, presetIds), presets).whereExpr;
}

describe("handleListExpr", () => {
  it("renders one handle, several, or none", () => {
    expect(handleListExpr(["A"])).toBe("handle == 'A'");
    expect(handleListExpr(["A", "B"])).toBe("handle in ['A', 'B']");
    expect(handleListExpr([])).toBe("handle == ''");
    expect(handleListExpr(["A'B\\"])).toBe("handle == 'AB'");
  });
});

describe("Bookmarked and Home person", () => {
  it("uses each type's own bookmarks", () => {
    expect(compile(["bookmarked"], context())).toBe("(handle in ['H1', 'H2'])");
    expect(compile(["family-bookmarked"], context(), "Family")).toBe("(handle == 'F1')");
    expect(compile(["note-bookmarked"], context(), "Note")).toBe("(handle == '')");
  });

  it("can't be used before the bookmarks load", () => {
    expect(() => compile(["bookmarked"], context({ bookmarks: null }))).toThrow(/haven't loaded/);
  });

  it("uses the home person, and says when there is none", () => {
    expect(compile(["home-person"], context())).toBe("(handle == 'HOME')");
    expect(() => compile(["home-person"], context({ homePersonHandle: null }))).toThrow(FilterCombineError);
    expect(() => compile(["home-person"], context({ homePersonHandle: null }))).toThrow(/no home person is set/);
  });
});

describe("Matches saved filter", () => {
  it("inlines the saved filter's own rules", () => {
    const ctx = context({ savedFilters: [saved("a", "Women", ["females", "has-notes"])] });
    expect(compile(["saved-filter:a", "bookmarked"], ctx)).toBe(
      "((((gender == Person.FEMALE) and (any(n for n in notes)))) and (handle in ['H1', 'H2']))",
    );
  });

  it("follows a saved filter that uses another", () => {
    const ctx = context({
      savedFilters: [saved("outer", "Outer", ["saved-filter:inner", "males"]), saved("inner", "Inner", ["home-person"])],
    });
    expect(compile(["saved-filter:outer"], ctx)).toBe("((((handle == 'HOME')) and (gender == Person.MALE)))");
  });

  it("reports a saved filter that uses itself instead of looping", () => {
    const ctx = context({
      savedFilters: [saved("a", "A", ["saved-filter:b"]), saved("b", "B", ["saved-filter:a"]), saved("c", "C", ["males"])],
    });
    expect(() => compile(["saved-filter:a"], ctx)).toThrow(/uses itself/);
    expect(compile(["saved-filter:c"], ctx)).toBe("((gender == Person.MALE))");
  });

  it("reports a saved filter that can't be compiled", () => {
    const ctx = context({ savedFilters: [saved("a", "Broken", ["no-such-rule"])] });
    expect(() => compile(["saved-filter:a"], ctx)).toThrow(/Broken.*can't be used.*no-such-rule/);
  });

  it("is offered only on its own list", () => {
    const presets = contextPresets(gqlFilterPresets, context({ savedFilters: [saved("f", "Fams", ["family-private"], "Family")] }));
    expect(presets.find((p) => p.id === "saved-filter:f")?.namespace).toBe("Family");
  });
});
