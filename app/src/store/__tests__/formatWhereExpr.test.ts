import { describe, expect, it } from "vitest";

import { formatWhereExpr } from "../formatWhereExpr";

describe("formatWhereExpr", () => {
  it("keeps a single leaf on one line", () => {
    expect(formatWhereExpr("(gender == Person.FEMALE)")).toBe("(gender == Person.FEMALE)");
  });

  it("breaks a flat AND of two leaves onto their own lines", () => {
    expect(formatWhereExpr("((gender == Person.FEMALE) and (exists(media)))")).toBe(
      [
        "(",
        "  (gender == Person.FEMALE)",
        "  and",
        "  (exists(media))",
        ")",
      ].join("\n"),
    );
  });

  it("breaks a flat OR of two leaves the same way", () => {
    expect(formatWhereExpr("((gender == Person.MALE) or (gender == Person.FEMALE))")).toBe(
      [
        "(",
        "  (gender == Person.MALE)",
        "  or",
        "  (gender == Person.FEMALE)",
        ")",
      ].join("\n"),
    );
  });

  it("indents a not(...)-wrapped leaf", () => {
    expect(formatWhereExpr("not ((exists(notes)))")).toBe(
      ["not (", "  (exists(notes))", ")"].join("\n"),
    );
  });

  it("indents a not(...)-wrapped group", () => {
    expect(
      formatWhereExpr("not ((gender == Person.MALE) or (gender == Person.FEMALE))"),
    ).toBe(
      [
        "not (",
        "  (gender == Person.MALE)",
        "  or",
        "  (gender == Person.FEMALE)",
        ")",
      ].join("\n"),
    );
  });

  it("nests a mixed AND/OR group under its own indent level", () => {
    const expr =
      "((exists(media)) and ((gender == Person.MALE) or (gender == Person.FEMALE)))";
    expect(formatWhereExpr(expr)).toBe(
      [
        "(",
        "  (exists(media))",
        "  and",
        "  (",
        "    (gender == Person.MALE)",
        "    or",
        "    (gender == Person.FEMALE)",
        "  )",
        ")",
      ].join("\n"),
    );
  });

  it("doesn't mis-split a leaf whose own text isn't wrapped in and/or keywords (Date(...) args, commas)", () => {
    const expr = "(Date('Jan 1, 1900') <= birth.date.sortval <= Date('Dec 31, 1950'))";
    expect(formatWhereExpr(expr)).toBe(expr);
  });
});
