import { describe, expect, it } from "vitest";

import { gqlFilterPresets } from "../../data/gqlFilterPresets";
import { combineFilters, datetimeParamToSeconds, FilterCombineError } from "../goqlFilterCombiner";

// These strings are what tests/gql_presets/helpers.py's fill() produces and checks against gramps-core; keep the two in step.

function render(id: string, values: Record<string, string>): string {
  const preset = gqlFilterPresets.find((p) => p.id === id);
  if (!preset) throw new Error(`fixture bug: no preset "${id}"`);
  return combineFilters({ kind: "preset", preset, values }).whereExpr;
}

describe("built-in param types", () => {
  it("renders a standard Gramps type as its value", () => {
    expect(render("event-type", { eventType: "Birth" })).toBe("((type == 'Birth'))");
  });

  it("renders an unknown type name as a custom type, quotes escaped", () => {
    expect(render("event-type", { eventType: "LV'G" })).toBe("((type == 'LV\\'G'))");
  });

  it("renders a type condition on a comprehension variable", () => {
    expect(render("event-note-type", { noteType: "Event Note" })).toBe("(any((n.type == 'Event Note') for n in notes))");
  });

  it("renders the repository type and source attribute tables", () => {
    expect(render("repository-type", { repositoryType: "Library" })).toBe("((type == 'Library'))");
    expect(render("source-attribute", { attributeType: "Book Cover Type", value: "paper" })).toBe(
      "(any((a.type == 'Book Cover Type') and 'paper' in a.value for a in attribute_list))",
    );
  });

  it("leaves standard vs custom (FamilyRelType's Custom is 4) to GOQL", () => {
    expect(render("family-relationship-type", { relType: "Married" })).toBe("((type == 'Married'))");
    expect(render("family-relationship-type", { relType: "Living Apart" })).toBe(
      "((type == 'Living Apart'))",
    );
  });

  it("doubles backslashes in a regex and escapes quotes", () => {
    expect(render("event-id-matches", { pattern: "^e\\d{3}'1$" })).toBe("(regex(gramps_id, '(?i)^e\\\\d{3}\\'1$'))");
  });

  it("rejects an invalid regex", () => {
    expect(() => render("event-id-matches", { pattern: "(" })).toThrow(FilterCombineError);
  });

  it("renders a regex on a whole Note's text", () => {
    expect(render("note-text-matches", { pattern: "lewis\\s+anderson" })).toBe(
      "(regex(text.string, '(?i)lewis\\\\s+anderson'))",
    );
  });

  it("accepts only a listed choice", () => {
    expect(render("place-reference-count", { comparison: ">", count: "3" })).toBe("(len(backlinks) > 3)");
    expect(() => render("place-reference-count", { comparison: "> 0 or 1", count: "3" })).toThrow(FilterCombineError);
  });

  it("renders a datetime as local Unix seconds, like gramps-core's ChangedSince", () => {
    const seconds = new Date(2024, 4, 1, 14, 30, 0).getTime() / 1000;
    expect(render("event-changed-since", { since: "2024-05-01 14:30" })).toBe(`(change >= ${seconds})`);
  });
});

describe("datetimeParamToSeconds", () => {
  it("fills missing parts with the earliest value", () => {
    expect(datetimeParamToSeconds("2024")).toBe(new Date(2024, 0, 1).getTime() / 1000);
    expect(datetimeParamToSeconds("2024-03")).toBe(new Date(2024, 2, 1).getTime() / 1000);
    expect(datetimeParamToSeconds("2024-03-05 7")).toBe(new Date(2024, 2, 5, 7).getTime() / 1000);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "May 2024", "2024-13-01", "2024-02-31", "2024-01-01 25:00", "1+1"]) {
      expect(datetimeParamToSeconds(bad)).toBeNull();
    }
  });
});
