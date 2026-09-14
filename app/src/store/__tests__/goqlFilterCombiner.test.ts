import { describe, expect, it } from "vitest";

import { gqlFilterPresets } from "../../data/gqlFilterPresets";
import { combineFilters, FilterCombineError, type FilterNode } from "../goqlFilterCombiner";

function preset(id: string) {
  const found = gqlFilterPresets.find((p) => p.id === id);
  if (!found) throw new Error(`fixture bug: no preset "${id}"`);
  return found;
}

describe("combineFilters", () => {
  it("renders a single preset with no wrapping and/or", () => {
    const node: FilterNode = { kind: "preset", preset: preset("females") };
    expect(combineFilters(node)).toEqual({
      namespace: "Person",
      whereExpr: "(gender == Person.FEMALE)",
    });
  });

  it("ANDs multiple presets in the same namespace", () => {
    const node: FilterNode = {
      kind: "and",
      children: [
        { kind: "preset", preset: preset("females") },
        { kind: "preset", preset: preset("has-media") },
      ],
    };
    expect(combineFilters(node).whereExpr).toBe("((gender == Person.FEMALE) and (exists(media)))");
  });

  it("ORs multiple presets and negates a subtree", () => {
    const node: FilterNode = {
      kind: "or",
      children: [
        { kind: "preset", preset: preset("males") },
        { kind: "not", child: { kind: "preset", preset: preset("has-notes") } },
      ],
    };
    expect(combineFilters(node).whereExpr).toBe(
      "((gender == Person.MALE) or not ((exists(notes))))",
    );
  });

  it("substitutes year params into a parameterized preset", () => {
    const node: FilterNode = {
      kind: "preset",
      preset: preset("birth-year-between"),
      values: { startYear: "1900", endYear: "1950" },
    };
    expect(combineFilters(node).whereExpr).toBe(
      "(Date('Jan 1, 1900') <= birth.date.sortval <= Date('Dec 31, 1950'))",
    );
  });

  it("rejects a non-numeric year value", () => {
    const node: FilterNode = {
      kind: "preset",
      preset: preset("birth-year-between"),
      values: { startYear: "1900'); DROP", endYear: "1950" },
    };
    expect(() => combineFilters(node)).toThrow(FilterCombineError);
  });

  it("rejects a missing param value", () => {
    const node: FilterNode = { kind: "preset", preset: preset("death-year-between") };
    expect(() => combineFilters(node)).toThrow(FilterCombineError);
  });

  it("rejects an unsupported preset", () => {
    const node: FilterNode = { kind: "preset", preset: preset("adopted") };
    expect(() => combineFilters(node)).toThrow(FilterCombineError);
  });

  it("rejects mixing namespaces", () => {
    const node: FilterNode = {
      kind: "and",
      children: [
        { kind: "preset", preset: preset("females") },
        { kind: "preset", preset: preset("families-incomplete-events") },
      ],
    };
    expect(() => combineFilters(node)).toThrow(FilterCombineError);
  });

  it("rejects an empty and/or group", () => {
    expect(() => combineFilters({ kind: "and", children: [] })).toThrow(FilterCombineError);
  });
});
