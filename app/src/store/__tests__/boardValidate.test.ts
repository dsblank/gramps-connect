import { describe, expect, it } from "vitest";
import { applyChanges, ChangeBuilder } from "../board/changes";
import {
  addEventRef,
  addMediaRef,
  addRepoRef,
  cite,
  linkParentChild,
  linkPartners,
  newCitation,
  newEvent,
  newNote,
  newPerson,
  newPlace,
  newRepository,
  newSource,
  setEventPlace,
} from "../board/links";
import { blank, GENDER, type GrampsRecord } from "../board/records";
import { RecordValidationError, validateRecord, validateRecords } from "../board/validate";

const john = () => blank<GrampsRecord>("Person", { handle: "john", gramps_id: "I0001", gender: GENDER.MALE });

describe("records the board builds are valid", () => {
  it("every kind of record and link the helpers make passes Gramps' schema", () => {
    const base = { john: john(), M1: blank<GrampsRecord>("Media", { handle: "M1", gramps_id: "O0001", path: "a.jpg", mime: "image/jpeg" }) };
    const b = new ChangeBuilder(base);
    const ruth = newPerson(b, { first: "Ruth", surname: "Carter", gender: "F" });
    linkPartners(b, "john", ruth);
    const anna = newPerson(b, { first: "Anna" });
    linkParentChild(b, "john", anna);
    const e = newEvent(b, "BIRTH", { date: blank("Date", { dateval: [8, 3, 1935, false], sortval: 0 }) });
    addEventRef(b, anna, e);
    const place = newPlace(b, "Dayton, Ohio");
    setEventPlace(b, e, place);
    const repo = newRepository(b, "Dayton Metro Library");
    const s = newSource(b, "Birth records");
    addRepoRef(b, s, repo);
    cite(b, e, newCitation(b, s, "p. 1"));
    addMediaRef(b, ruth, "M1", [10, 10, 40, 40]);
    newNote(b, "{}", "Case File");
    const records = Object.values(applyChanges(base, [b.change("everything")])).map((r) => ({ ...r, gramps_id: r.gramps_id || "X1" }));
    expect(() => validateRecords(records)).not.toThrow();
    expect(records.length).toBeGreaterThan(10);
  });
});

describe("malformed records are refused, with the record named", () => {
  it("a type given as a word instead of Gramps' type object", () => {
    const e = blank<GrampsRecord>("Event", { handle: "e", gramps_id: "E1", type: "Birth" });
    expect(() => validateRecord(e)).toThrow(/Event E1: \/type/);
  });

  it("a field Gramps doesn't have, nested", () => {
    const p = john();
    p.primary_name = { ...(p.primary_name as object), nickname_typo: "x" };
    expect(() => validateRecord(p)).toThrow(/unknown Name field\(s\) nickname_typo/);
  });

  it("a child reference that points at nothing", () => {
    // No ref at all: Gramps' schema catches it. An empty one: our own check.
    const missing = blank<GrampsRecord>("Family", { handle: "f", gramps_id: "F1", child_ref_list: [blank("ChildRef")] });
    expect(() => validateRecord(missing)).toThrow(/Family F1: \/child_ref_list\/0\/ref/);
    const empty = blank<GrampsRecord>("Family", { handle: "f", gramps_id: "F1", child_ref_list: [blank("ChildRef", { ref: "" })] });
    expect(() => validateRecord(empty)).toThrow(/ChildRef must point at a record/);
  });

  it("a date range with only one end", () => {
    const e = blank<GrampsRecord>("Event", { handle: "e", gramps_id: "E1", date: blank("Date", { modifier: 4, dateval: [0, 0, 1900, false] }) });
    expect(() => validateRecord(e)).toThrow(/needs 8 values/);
  });

  it("a wrong value type at the top level", () => {
    const p = { ...john(), gender: "male" } as GrampsRecord;
    expect(() => validateRecord(p)).toThrow(RecordValidationError);
  });

  it("a family's `complete` flag is allowed, though Gramps' schema doesn't list it", () => {
    const f = blank<GrampsRecord>("Family", { handle: "f", gramps_id: "F1", complete: 1 });
    expect(() => validateRecord(f)).not.toThrow();
  });
});
