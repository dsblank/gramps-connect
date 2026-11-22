// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseDate } from "@gramps-connect/gramps-date";
import { formatCitationText, formatSourceText } from "../citationFormat";
import { formatDisplayDate } from "../placeIndex";

// Expected strings follow gramps/plugins/cite/legacy.py and addons-source's
// CiteEnhanced/citeenhanced.py with English (untranslated) separators.
describe("formatSourceText", () => {
  const source = { author: "Smith, John", title: "Parish Registers", pubinfo: "London, 1890", abbrev: "PR" };

  it("writes Legacy as author, quoted title, publication info, (abbreviation)", () => {
    expect(formatSourceText("legacy", source)).toBe('Smith, John, "Parish Registers", London, 1890, (PR)');
  });

  it("skips empty fields without leaving stray separators", () => {
    expect(formatSourceText("legacy", { title: "Census" })).toBe('"Census"');
    expect(formatSourceText("legacy", {})).toBe("");
    expect(formatSourceText("legacy", null)).toBe("");
  });

  it("ignores the repository for Legacy", () => {
    expect(formatSourceText("legacy", { title: "Census" }, { name: "Archive", callNumber: "A1" })).toBe('"Census"');
  });

  it("starts Enhanced with the repository and call number", () => {
    expect(formatSourceText("enhanced", { title: "Census" }, { name: "Archive", callNumber: "A1" })).toBe('Archive [A1], "Census"');
    expect(formatSourceText("enhanced", { title: "Census" }, { name: "Archive" })).toBe('Archive, "Census"');
    expect(formatSourceText("enhanced", { title: "Census" }, null)).toBe('"Census"');
    expect(formatSourceText("enhanced", { title: "Census" }, { name: "" })).toBe('"Census"');
  });
});

describe("formatCitationText", () => {
  it("writes page - date, or whichever one exists", () => {
    const date = parseDate("1890-05-01", { locale: "en" });
    const shown = formatDisplayDate(date);
    expect(shown).not.toBe("");
    expect(formatCitationText({ page: "p. 12", date, confidence: 2 })).toBe(`p. 12 - ${shown}`);
    expect(formatCitationText({ date, confidence: 2 })).toBe(shown);
    expect(formatCitationText({ page: "p. 12", confidence: 2 })).toBe("p. 12");
  });

  it("adds the confidence only when it isn't Normal", () => {
    expect(formatCitationText({ page: "p. 12", confidence: 4 })).toBe("p. 12 [Very High]");
    expect(formatCitationText({ page: "p. 12", confidence: 0 })).toBe("p. 12 [Very Low]");
    expect(formatCitationText({ page: "p. 12" })).toBe("p. 12");
  });
});
