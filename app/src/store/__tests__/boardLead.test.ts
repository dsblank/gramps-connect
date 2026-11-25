import { describe, expect, it } from "vitest";
import { applyChanges, ChangeBuilder } from "../board/changes";
import { addLeadEvent, addLeadPerson, addLeadRepository, addLeadSource, existingEvent, familyToLoad, OCCASIONS, relationChoices, relativesOf, setLeadRole } from "../board/lead";
import { blank, GENDER, grampsType, isType, type GrampsRecord, type Records } from "../board/records";

const person = (handle: string, gender: number, extra: Record<string, unknown> = {}) =>
  blank<GrampsRecord>("Person", { handle, gramps_id: handle, gender, ...extra });
const family = (handle: string, father: string | null, mother: string | null, children: string[], extra: Record<string, unknown> = {}) =>
  blank<GrampsRecord>("Family", { handle, gramps_id: handle, father_handle: father, mother_handle: mother, child_ref_list: children.map((ref) => blank("ChildRef", { ref })), ...extra });
const event = (handle: string, type: string) => blank<GrampsRecord>("Event", { handle, gramps_id: handle, type: grampsType("EventType", type) });
const media = (handle: string) => blank<GrampsRecord>("Media", { handle, gramps_id: handle, mime: "image/jpeg" });

/**
 * Walter + Helen (F0) -> John, Mary.  John + Ruth (F1, married E1) -> Anna (home), David.
 */
function tree(): Records {
  const rs = [
    person("walter", GENDER.MALE, { family_list: ["F0"] }),
    person("helen", GENDER.FEMALE, { family_list: ["F0"] }),
    person("john", GENDER.MALE, { parent_family_list: ["F0"], family_list: ["F1"] }),
    person("mary", GENDER.FEMALE, { parent_family_list: ["F0"] }),
    person("ruth", GENDER.FEMALE, { family_list: ["F1"], event_ref_list: [blank("EventRef", { ref: "B1", role: grampsType("EventRoleType", "PRIMARY") })] }),
    person("anna", GENDER.FEMALE, { parent_family_list: ["F1"] }),
    person("david", GENDER.MALE, { parent_family_list: ["F1"] }),
    family("F0", "walter", "helen", ["john", "mary"]),
    family("F1", "john", "ruth", ["anna", "david"], { event_ref_list: [blank("EventRef", { ref: "E1", role: grampsType("EventRoleType", "FAMILY") })] }),
    event("E1", "MARRIAGE"),
    event("B1", "BIRTH"),
    media("M1"),
  ];
  return Object.fromEntries(rs.map((r) => [r.handle, r]));
}

function act(records: Records, action: (b: ChangeBuilder) => void): Records {
  const b = new ChangeBuilder(records);
  action(b);
  return applyChanges(records, [b.change("x")]);
}

describe("the Home person's family", () => {
  it("asks for what's missing, round by round", () => {
    const all = tree();
    expect(familyToLoad("anna", {})).toEqual(["anna"]);
    expect(familyToLoad("anna", { anna: all.anna })).toEqual(["F1"]);
    const round3 = familyToLoad("anna", { anna: all.anna, F1: all.F1 });
    expect(round3.sort()).toEqual(["david", "john", "ruth"]);
    expect(familyToLoad("anna", all)).toEqual([]);
  });

  it("names relatives closest first", () => {
    const { list, parents } = relativesOf("anna", tree());
    expect(list.map((r) => `${r.handle}:${r.rel}`)).toEqual([
      "anna:You", "john:Your father", "ruth:Your mother", "david:Your brother",
      "walter:Your grandfather", "helen:Your grandmother", "mary:Your aunt",
    ]);
    expect(parents).toEqual(["john", "ruth"]);
  });

  it("offers ways to tie in someone new", () => {
    const choices = relationChoices("anna", "x", ["x", "ruth"], { ...tree(), x: person("x", GENDER.UNKNOWN) });
    expect(choices.map((c) => `${c.how}:${c.to}`)).toEqual([
      "parent:anna", "sibling:anna", "child:anna", "sibling:john", "parent:john", "sibling:ruth", "parent:ruth", "partner:ruth",
    ]);
  });
});

describe("is this the same one?", () => {
  it("finds the couple's wedding and someone's own birth", () => {
    const records = tree();
    expect(existingEvent(OCCASIONS[0], "john", "ruth", records)).toEqual({ event: "E1", family: "F1" });
    expect(existingEvent(OCCASIONS[0], "john", "mary", records)).toBeNull();
    expect(existingEvent(OCCASIONS[1], "ruth", null, records)).toEqual({ event: "B1" });
    expect(existingEvent(OCCASIONS[1], "anna", null, records)).toBeNull();
    expect(existingEvent(OCCASIONS[6], "ruth", null, records)).toBeNull();
  });
});

describe("the guide's changes", () => {
  it("makes the source and citation, with the file on both", () => {
    let source = "";
    let citation = "";
    const after = act(tree(), (b) => ({ source, citation } = addLeadSource(b, "Wedding photo", "M1")));
    expect(after[source].title).toBe("Wedding photo");
    expect(after[citation].source_handle).toBe(source);
    expect((after[source].media_list as { ref: string }[])[0].ref).toBe("M1");
    expect((after[citation].media_list as { ref: string }[])[0].ref).toBe("M1");
  });

  it("files the source in a new collection", () => {
    let repo = "";
    let records = tree();
    let source = "";
    records = act(records, (b) => ({ source } = addLeadSource(b, "Letter", null)));
    records = act(records, (b) => (repo = addLeadRepository(b, source, { name: "Aunt Martha's box" })));
    expect(records[repo].name).toBe("Aunt Martha's box");
    expect(isType(records[repo].type, "RepositoryType", "COLLECTION")).toBe(true);
    expect((records[source].reporef_list as { ref: string }[])[0].ref).toBe(repo);
  });

  it("puts people in the photo citing the document, once", () => {
    let records = tree();
    let made = "";
    records = act(records, (b) => {
      addLeadPerson(b, { media: "M1", citation: "C1" }, { handle: "anna" });
      addLeadPerson(b, { media: "M1", citation: "C1" }, { handle: "anna" });
      made = addLeadPerson(b, { media: "M1", citation: "C1" }, { first: "Martha", surname: "", gender: "F" });
    });
    expect(records.anna.citation_list).toEqual(["C1"]);
    expect((records.anna.media_list as unknown[]).length).toBe(1);
    expect(records[made].gender).toBe(GENDER.FEMALE);
    expect(records[made].citation_list).toEqual(["C1"]);
  });

  it("adds a new wedding to the couple's family, and roles for the others", () => {
    let records = tree();
    let ev = "";
    records = act(records, (b) => {
      ev = addLeadEvent(b, { media: "M1", citation: "C1" }, OCCASIONS[0], { who1: "john", who2: "ruth", date: null, place: { name: "Xenia, Ohio" } }).event;
    });
    const famEvents = (records.F1.event_ref_list as { ref: string }[]).map((r) => r.ref);
    expect(famEvents).toContain(ev);
    expect(records[ev].citation_list).toEqual(["C1"]);
    expect(records[records[ev].place as string].title).toBe("Xenia, Ohio");
    records = act(records, (b) => setLeadRole(b, "mary", ev, { role: "WITNESS" }, false));
    records = act(records, (b) => setLeadRole(b, "mary", ev, { role: "CUSTOM", custom: "Bridesmaid" }, true));
    const refs = (records.mary.event_ref_list as { ref: string; role: { string: string } }[]).filter((r) => r.ref === ev);
    expect(refs).toHaveLength(1);
    expect(refs[0].role.string).toBe("Bridesmaid");
  });

  it("gives a person their own new event", () => {
    let records = tree();
    let ev = "";
    records = act(records, (b) => {
      ev = addLeadEvent(b, { media: null, citation: null }, OCCASIONS[7], { who1: "anna", who2: null, date: null, place: null, otherName: "First communion" }).event;
    });
    expect((records[ev].type as { string: string }).string).toBe("First communion");
    expect((records.anna.event_ref_list as { ref: string }[]).map((r) => r.ref)).toContain(ev);
  });
});
