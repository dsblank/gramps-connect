import { describe, expect, it } from "vitest";
import { formatName, type RawName } from "../nameDisplay";
// Expected values are Gramps' own output for each name and format: see the
// fixture's _source.
import fixture from "./nameDisplay.fixture.json";

const cases = fixture.cases as Record<string, RawName>;
const expected = fixture.expected as Record<string, Record<string, string>>;

describe("formatName matches Gramps' NameDisplay", () => {
  for (const [label, name] of Object.entries(cases)) {
    it(label, () => {
      for (const [format, want] of Object.entries(expected[label])) {
        expect([format, formatName(name, format)]).toEqual([format, want]);
      }
    });
  }
});

describe("formatName", () => {
  it("tolerates a sparse draft name", () => {
    expect(formatName({ first_name: "Ann", surname_list: [{ surname: "" }] }, "%l, %f %s")).toBe(", Ann");
    expect(formatName({}, "%f %l")).toBe("");
    expect(formatName(null, "%f")).toBe("");
  });
});
