import { describe, expect, it } from "vitest";
import { emptyCaseFile } from "../board/caseFile";
import { caseExport, caseExportFileName } from "../board/caseExport";
import { blank, type GrampsRecord } from "../board/records";

const card = (handle: string) => ({ handle, class: "Person" as const, gramps_id: handle, label: handle, seenChange: 1, x: 0, y: 0, size: "compact" as const });

describe("downloading a case file", () => {
  it("holds the case and its saved records, and only names unsaved work", () => {
    const john = blank<GrampsRecord>("Person", { handle: "john", gramps_id: "I1" });
    const file = { ...emptyCaseFile("Ruth's parents", "doug"), cards: [card("john"), card("draft-made")] };
    const out = caseExport(file, { john, other: blank<GrampsRecord>("Person", { handle: "other" }) }, ["New person"], new Date("2026-11-24T00:00:00Z"));
    expect(out.case.cards.map((c) => c.handle)).toEqual(["john"]);
    expect(Object.keys(out.records)).toEqual(["john"]);
    expect(out.unsaved).toEqual(["New person"]);
    expect(out.exported).toBe("2026-11-24T00:00:00.000Z");
  });

  it("names the file after the case, safely", () => {
    expect(caseExportFileName("Ruth Carter's parents")).toBe("Ruth Carter's parents.case.json");
    expect(caseExportFileName('a/b: "c"?')).toBe("a b c.case.json");
    expect(caseExportFileName("  ")).toBe("Case file.case.json");
  });
});
