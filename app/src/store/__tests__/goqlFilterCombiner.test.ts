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

  it("substitutes date params into a parameterized preset", () => {
    const node: FilterNode = {
      kind: "preset",
      preset: preset("birth-year-between"),
      values: { startDate: "1 Jan 1900", endDate: "31 Dec 1950" },
    };
    expect(combineFilters(node).whereExpr).toBe(
      "(Date('1 Jan 1900') <= birth.date.sortval <= Date('31 Dec 1950'))",
    );
  });

  it("strips quotes/backslashes from a date param instead of letting it break out of the string literal", () => {
    const node: FilterNode = {
      kind: "preset",
      preset: preset("birth-year-between"),
      values: { startDate: "1900'); DROP", endDate: "1950" },
    };
    expect(combineFilters(node).whereExpr).toBe(
      "(Date('1900); DROP') <= birth.date.sortval <= Date('1950'))",
    );
  });

  it("rejects a missing param value", () => {
    const node: FilterNode = { kind: "preset", preset: preset("death-year-between") };
    expect(() => combineFilters(node)).toThrow(FilterCombineError);
  });

  it("substitutes a text param into a parameterized preset", () => {
    const node: FilterNode = {
      kind: "preset",
      preset: preset("has-tag"),
      values: { tagName: "ToDo" },
    };
    expect(combineFilters(node).whereExpr).toBe("(exists(tags, name == 'ToDo'))");
  });

  it("strips quotes/backslashes from a text param instead of letting them break out of the string literal", () => {
    const node: FilterNode = {
      kind: "preset",
      preset: preset("has-tag"),
      values: { tagName: "x') or (1==1) or exists(tags, name == 'x" },
    };
    // Every `'` (and any `\`) is stripped, not escaped -- same convention
    // simpleSearch.ts/personSearch.ts already use for user-typed search
    // text -- so the value can never close the surrounding '...' literal
    // early, regardless of what it contains.
    expect(combineFilters(node).whereExpr).toBe(
      "(exists(tags, name == 'x) or (1==1) or exists(tags, name == x'))",
    );
  });

  it("rejects a text param made up of only quotes/backslashes", () => {
    const node: FilterNode = { kind: "preset", preset: preset("has-tag"), values: { tagName: "''" } };
    expect(() => combineFilters(node)).toThrow(FilterCombineError);
  });

  it("substitutes an integer param raw, unquoted", () => {
    const customPreset = {
      id: "custom-min-age",
      label: "Custom rule",
      category: "Custom" as const,
      namespace: "Person" as const,
      sourceRule: "",
      expr: "count(families) > {minCount}",
      params: [{ name: "minCount", label: "Minimum count", type: "integer" as const }],
      supported: true,
    };
    const node: FilterNode = { kind: "preset", preset: customPreset, values: { minCount: "-3" } };
    expect(combineFilters(node).whereExpr).toBe("(count(families) > -3)");
  });

  it("rejects an integer param that isn't a whole number", () => {
    const customPreset = {
      id: "custom-min-age",
      label: "Custom rule",
      category: "Custom" as const,
      namespace: "Person" as const,
      sourceRule: "",
      expr: "count(families) > {minCount}",
      params: [{ name: "minCount", label: "Minimum count", type: "integer" as const }],
      supported: true,
    };
    const node: FilterNode = { kind: "preset", preset: customPreset, values: { minCount: "3 or 1==1" } };
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
