import { describe, expect, it } from "vitest";
import { formatImportMessages, parseImportResult } from "../importApi";

describe("parseImportResult", () => {
  it("splits counts from messages", () => {
    expect(
      parseImportResult({ people: 3, families: 0, messages: ["bad line", "  "] })
    ).toEqual({ counts: { people: 3, families: 0 }, messages: ["bad line"] });
  });

  it("treats a missing body or messages field (pre-v3.23.0 server) as no report", () => {
    expect(parseImportResult(null)).toEqual({ counts: {}, messages: [] });
    expect(parseImportResult({ people: 1 })).toEqual({ counts: { people: 1 }, messages: [] });
  });
});

describe("formatImportMessages", () => {
  it("moves GEDCOM source lines onto their own indented line", () => {
    expect(
      formatImportMessages(["Import Complete: 1 errors", "Tag recognized but not supported      Line   144: 1 FILE x.jpg"])
    ).toBe("Import Complete: 1 errors\nTag recognized but not supported\n    Line   144: 1 FILE x.jpg");
  });
});
