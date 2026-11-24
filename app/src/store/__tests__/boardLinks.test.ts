import { describe, expect, it } from "vitest";
import { applyChanges, ChangeBuilder, takeBack, toggleChange, withDependents, type Change } from "../board/changes";
import {
  addChild,
  addEventRef,
  addMediaRef,
  addRepoRef,
  cite,
  linkParentChild,
  linkPartners,
  linkSiblings,
  newCitation,
  newEvent,
  newNote,
  newPerson,
  newSource,
  removeChild,
  removeEventRef,
  setEventType,
  setMediaRegion,
  setParent,
} from "../board/links";
import { blank, GENDER, grampsType, typeCode, type GrampsRecord, type Records } from "../board/records";

const person = (handle: string, gender: number, extra: Record<string, unknown> = {}) =>
  blank<GrampsRecord>("Person", { handle, gramps_id: handle, gender, ...extra });
const family = (handle: string, extra: Record<string, unknown> = {}) => blank<GrampsRecord>("Family", { handle, gramps_id: handle, ...extra });
const event = (handle: string, type: string) => blank<GrampsRecord>("Event", { handle, gramps_id: handle, type: grampsType("EventType", type) });

/** John (M) and Ruth (F) in family F1 with child Anna; David is unattached. */
function tree(): Records {
  const records = [
    person("john", GENDER.MALE, { family_list: ["F1"] }),
    person("ruth", GENDER.FEMALE, { family_list: ["F1"] }),
    person("anna", GENDER.FEMALE, { parent_family_list: ["F1"] }),
    person("david", GENDER.MALE),
    family("F1", { father_handle: "john", mother_handle: "ruth", child_ref_list: [blank("ChildRef", { ref: "anna" })] }),
  ];
  return Object.fromEntries(records.map((r) => [r.handle, r]));
}

/** Builds one change against `records` with `action`, returns the change and the result. */
function act(records: Records, action: (b: ChangeBuilder) => void, label = "x"): { change: Change; after: Records } {
  const b = new ChangeBuilder(records);
  action(b);
  const change = b.change(label);
  return { change, after: applyChanges(records, [change]) };
}

const childRefs = (r: GrampsRecord) => (r.child_ref_list as { ref: string }[]).map((c) => c.ref);

describe("family links write both sides", () => {
  it("adds a child to the parent's family, on the family and on the child", () => {
    const base = tree();
    const { after } = act(base, (b) => linkParentChild(b, "john", "david"));
    expect(childRefs(after.F1)).toEqual(["anna", "david"]);
    expect(after.david.parent_family_list).toEqual(["F1"]);
    expect(base.F1.child_ref_list).toHaveLength(1); // base untouched
  });

  it("creates a family when the parent has none", () => {
    const { change, after } = act(tree(), (b) => linkParentChild(b, "david", "anna"));
    const fam = after[change.creates[0]];
    expect(fam._class).toBe("Family");
    expect(fam.father_handle).toBe("david");
    expect(after.david.family_list).toEqual([fam.handle]);
    expect(after.anna.parent_family_list).toEqual(["F1", fam.handle]);
  });

  it("partners get one family, slots by gender, and an existing family is reused", () => {
    const { change, after } = act(tree(), (b) => linkPartners(b, "anna", "david"));
    const fam = after[change.creates[0]];
    expect([fam.father_handle, fam.mother_handle]).toEqual(["david", "anna"]);
    const again = act(tree(), (b) => linkPartners(b, "john", "ruth")).change;
    expect(again.steps).toHaveLength(0);
  });

  it("siblings join the family one of them is a child in", () => {
    const { after } = act(tree(), (b) => linkSiblings(b, "david", "anna"));
    expect(childRefs(after.F1)).toEqual(["anna", "david"]);
    expect(after.david.parent_family_list).toEqual(["F1"]);
  });

  it("replacing a parent takes the family off the previous parent's list", () => {
    const { after } = act(tree(), (b) => setParent(b, "F1", "david", "father"));
    expect(after.F1.father_handle).toBe("david");
    expect(after.john.family_list).toEqual([]);
    expect(after.david.family_list).toEqual(["F1"]);
  });

  it("removing a child removes both sides", () => {
    const { after } = act(tree(), (b) => removeChild(b, "F1", "anna"));
    expect(childRefs(after.F1)).toEqual([]);
    expect(after.anna.parent_family_list).toEqual([]);
  });

  it("adding a child twice is a no-op", () => {
    const { change } = act(tree(), (b) => addChild(b, "F1", "anna"));
    expect(change.steps).toHaveLength(0);
  });
});

describe("events keep birth and death in step", () => {
  const withEvents = (): Records => ({ ...tree(), ebirth: event("ebirth", "BIRTH"), edeath: event("edeath", "DEATH"), ecensus: event("ecensus", "CENSUS") });
  const roleOf = (r: GrampsRecord, i: number) => (r.event_ref_list as { role: { value: number } }[])[i].role.value;

  it("a primary Birth becomes the person's birth", () => {
    const { after } = act(withEvents(), (b) => {
      addEventRef(b, "anna", "ecensus");
      addEventRef(b, "anna", "ebirth");
      addEventRef(b, "anna", "edeath");
    });
    expect(after.anna.birth_ref_index).toBe(1);
    expect(after.anna.death_ref_index).toBe(2);
    expect(roleOf(after.anna, 0)).toBe(typeCode("EventRoleType", "PRIMARY"));
  });

  it("a witness role doesn't make it their birth", () => {
    const { after } = act(withEvents(), (b) => addEventRef(b, "anna", "ebirth", "WITNESS"));
    expect(after.anna.birth_ref_index).toBe(-1);
  });

  it("removing an earlier event shifts the indexes with it", () => {
    let records = withEvents();
    records = act(records, (b) => {
      addEventRef(b, "anna", "ecensus");
      addEventRef(b, "anna", "ebirth");
    }).after;
    const { after } = act(records, (b) => removeEventRef(b, "anna", "ecensus"));
    expect(after.anna.birth_ref_index).toBe(0);
    const gone = act(after, (b) => removeEventRef(b, "anna", "ebirth")).after;
    expect(gone.anna.birth_ref_index).toBe(-1);
  });

  it("changing a Birth to a Death moves it from birth to death", () => {
    const records = act(withEvents(), (b) => addEventRef(b, "anna", "ebirth")).after;
    const { after } = act(records, (b) => setEventType(b, "ebirth", "DEATH"));
    expect(after.anna.birth_ref_index).toBe(-1);
    expect(after.anna.death_ref_index).toBe(0);
  });

  it("families get the Family role", () => {
    const { after } = act({ ...tree(), ewed: event("ewed", "MARRIAGE") }, (b) => addEventRef(b, "F1", "ewed"));
    expect(roleOf(after.F1, 0)).toBe(typeCode("EventRoleType", "FAMILY"));
  });
});

describe("evidence, photos and notes", () => {
  it("cites a new source on an event, with the source kept at a repository", () => {
    const base = { ...tree(), ebirth: event("ebirth", "BIRTH"), R1: blank<GrampsRecord>("Repository", { handle: "R1", gramps_id: "R1" }) };
    const { change, after } = act(base, (b) => {
      const s = newSource(b, "Ohio birth records");
      addRepoRef(b, s, "R1");
      const c = newCitation(b, s, "p. 14");
      cite(b, "ebirth", c);
    });
    const [s, c] = change.creates;
    expect(after[c].source_handle).toBe(s);
    expect(after[c].page).toBe("p. 14");
    expect(after.ebirth.citation_list).toEqual([c]);
    expect((after[s].reporef_list as { ref: string }[]).map((r) => r.ref)).toEqual(["R1"]);
  });

  it("stores a face as a clamped percent region, and changes it in place", () => {
    const base = { ...tree(), M1: blank<GrampsRecord>("Media", { handle: "M1", gramps_id: "M1" }) };
    let after = act(base, (b) => addMediaRef(b, "ruth", "M1", [10.4, 20, 30, 140])).after;
    expect((after.ruth.media_list as { rect: number[] }[])[0].rect).toEqual([10, 20, 30, 100]);
    after = act(after, (b) => setMediaRegion(b, "ruth", "M1", [40, 5, 60, 30])).after;
    expect(after.ruth.media_list).toHaveLength(1);
    expect((after.ruth.media_list as { rect: number[] }[])[0].rect).toEqual([40, 5, 60, 30]);
    const empty = act(after, (b) => setMediaRegion(b, "ruth", "M1", [50, 50, 50, 60])).after;
    expect((empty.ruth.media_list as { rect: unknown }[])[0].rect).toBeNull();
  });

  it("makes a case-file note with a custom type", () => {
    const { change, after } = act(tree(), (b) => newNote(b, "{}", "Case File"));
    const note = after[change.creates[0]];
    expect(note.type).toEqual({ _class: "NoteType", value: typeCode("NoteType", "CUSTOM"), string: "Case File" });
    expect((note.text as { string: string }).string).toBe("{}");
  });
});

describe("loose ends: untick and take back", () => {
  it("unticking a new person also unticks linking them, and ticking the link brings the person back", () => {
    let records = tree();
    const create = act(records, (b) => newPerson(b, { first: "Martha", gender: "F" }), "new Martha").change;
    records = applyChanges(records, [create]);
    const martha = create.creates[0];
    const link = act(records, (b) => linkSiblings(b, martha, "ruth"), "Martha and Ruth are siblings").change;
    let list = [create, link];
    expect([...withDependents(list, [create.id])].sort()).toEqual([create.id, link.id].sort());
    list = toggleChange(list, create.id);
    expect(list.every((c) => c.off)).toBe(true);
    list = toggleChange(list, link.id);
    expect(list.every((c) => !c.off)).toBe(true);
    const back = takeBack(list, create.id);
    expect(back.changes).toEqual([]);
    expect(back.removed.map((c) => c.label)).toEqual(["new Martha", "Martha and Ruth are siblings"]);
  });

  it("a person and their birth made in one action stay together", () => {
    const { change, after } = act(tree(), (b) => {
      const p = newPerson(b, { first: "Martha", surname: "Carter", gender: "F" });
      const e = newEvent(b, "BIRTH");
      addEventRef(b, p, e);
    });
    const [p, e] = change.creates;
    expect(after[p].birth_ref_index).toBe(0);
    expect(after[e]._class).toBe("Event");
    expect(after[p].gramps_id).toBe("");
  });
});
