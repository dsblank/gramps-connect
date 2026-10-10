import { describe, expect, it } from "vitest";
import { grampletMenuGroups } from "../grampletMenu";
import type { Gramplet } from "../types";

function g(label: string, overrides: Partial<Gramplet> = {}): Gramplet {
  return { id: label, label, code: "", kind: "window", ...overrides };
}

const labels = (groups: ReturnType<typeof grampletMenuGroups>) =>
  groups.map((group) => [group.category, group.gramplets.map((x) => x.label)]);

describe("grampletMenuGroups", () => {
  it("is empty when there are no window Gramplets, leaving View Gramplets out", () => {
    expect(grampletMenuGroups([g("Panel one", { kind: undefined }), g("Panel two", { kind: "view" })])).toEqual([]);
  });

  it("is one flat, sorted list when everything shares a category (or has none)", () => {
    expect(labels(grampletMenuGroups([g("Beta"), g("Alpha")]))).toEqual([[null, ["Alpha", "Beta"]]]);
    expect(labels(grampletMenuGroups([g("Beta", { category: "chart" }), g("Alpha", { category: "Chart " })]))).toEqual([
      [null, ["Alpha", "Beta"]],
    ]);
  });

  it("groups by category, case-insensitively and capitalized, with uncategorized last under Other", () => {
    const groups = grampletMenuGroups(
      [
        g("Zed", { category: "utility" }),
        g("Loose"),
        g("Histogram", { category: "chart" }),
        g("Pie", { category: "Chart" }),
        g("Panel", { kind: "view", category: "chart" }),
      ],
      "Andere"
    );
    expect(labels(groups)).toEqual([
      ["Chart", ["Histogram", "Pie"]],
      ["Utility", ["Zed"]],
      ["Andere", ["Loose"]],
    ]);
  });
});
