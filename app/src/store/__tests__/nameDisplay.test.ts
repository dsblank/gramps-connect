import { describe, expect, it } from "vitest";
import { formatDisplayName, formatName, nameSortKeys, type RawName } from "../nameDisplay";
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

describe("formatDisplayName honors a name's own display_as", () => {
  const name: RawName = { first_name: "John", suffix: "Jr.", surname_list: [{ surname: "Smith", primary: true }] };

  it("uses the tree's format for Default (0) or no display_as", () => {
    expect(formatDisplayName(name)).toBe("Smith, John Jr.");
    expect(formatDisplayName({ ...name, display_as: 0 })).toBe("Smith, John Jr.");
  });

  it("uses a built-in format by number", () => {
    expect(formatDisplayName({ ...name, display_as: 2 })).toBe("John Smith Jr.");
    expect(formatDisplayName({ ...name, display_as: 4 })).toBe("John");
  });

  it("falls back to the tree's format for an inactive or unknown number", () => {
    // 3 is desktop's deprecated (inactive) "Patronymic, Given"; -7 isn't loaded.
    expect(formatDisplayName({ ...name, display_as: 3 })).toBe("Smith, John Jr.");
    expect(formatDisplayName({ ...name, display_as: -7 })).toBe("Smith, John Jr.");
  });

  it("accepts the JSON string a cache column stores", () => {
    expect(formatDisplayName(JSON.stringify({ ...name, display_as: 2 }))).toBe("John Smith Jr.");
  });
});

describe("nameSortKeys", () => {
  it("sorts the built-in formats by their own name order", () => {
    expect(nameSortKeys("%l, %f %s")).toEqual(["surname", "given_name"]);
    expect(nameSortKeys("%f %l %s")).toEqual(["given_name", "surname"]);
    expect(nameSortKeys("%f")).toEqual(["given_name", "surname"]);
    expect(nameSortKeys("%1m %2m %o, %f %1y %s %0m")).toEqual(["surname", "given_name"]);
  });

  it("uses a path key only when the format leads with a part that has no column", () => {
    expect(nameSortKeys('%n "%f" %l')).toEqual(["primary_name.nick", "given_name", "surname"]);
    expect(nameSortKeys("%t %f %l")).toEqual(["primary_name.title", "given_name", "surname"]);
    expect(nameSortKeys("%f (%n) %l")).toEqual(["given_name", "surname"]);
  });

  it("treats upper-case codes like lower-case ones and ignores %%", () => {
    expect(nameSortKeys("%L, %f")).toEqual(["surname", "given_name"]);
    expect(nameSortKeys("%%l %f")).toEqual(["given_name", "surname"]);
  });
});
