import { describe, expect, it } from "vitest";
import { applyChanges, ChangeBuilder } from "../board/changes";
import { connectOptions, newTypesFor, snip, standIn } from "../board/connect";
import { newCitation, newEvent, newNote, newPerson, newPlace, newRepository, newSource } from "../board/links";
import { blank, type GrampsRecord, type Records } from "../board/records";
import { deriveYarn } from "../board/view";

/** One of each kind of record, unconnected. */
function loose() {
  const start: Records = { M1: blank<GrampsRecord>("Media", { handle: "M1", gramps_id: "O1", desc: "Portrait" }) };
  const b = new ChangeBuilder(start);
  const h = {
    john: newPerson(b, { first: "John", gender: "M" }),
    ruth: newPerson(b, { first: "Ruth", gender: "F" }),
    wed: newEvent(b, "MARRIAGE"),
    place: newPlace(b, "Springfield"),
    source: newSource(b, "Marriage records"),
    repo: newRepository(b, "Court"),
    note: newNote(b, "Married at her parents' church"),
    media: "M1",
  };
  const cit = newCitation(b, h.source);
  const records = applyChanges(start, [b.change("loose")]);
  // a citation not yet tied to its source, to test tying that too
  records[cit] = { ...records[cit], source_handle: null };
  return { records, h: { ...h, cit } };
}

/** Applies the option labelled `label` between `x` and `y`. */
function tie(records: Records, x: string, y: string, label: RegExp): Records {
  const option = connectOptions(records, records[x], records[y]).find((o) => label.test(o.label));
  if (!option) throw new Error(`no option ${label} between ${x} and ${y}: ${connectOptions(records, records[x], records[y]).map((o) => o.label).join(" / ")}`);
  const b = new ChangeBuilder(records);
  option.build(b);
  return applyChanges(records, [b.change(option.label)]);
}

const all = (records: Records) => new Set(Object.keys(records));

describe("tying records in plain words", () => {
  it("offers the right choices for each pair", () => {
    const { records, h } = loose();
    const labels = (x: string, y: string) => connectOptions(records, records[x], records[y]).map((o) => o.label);
    expect(labels(h.john, h.ruth)).toEqual(["John is a parent of Ruth", "John is a child of Ruth", "John and Ruth are partners", "John and Ruth are siblings"]);
    expect(labels(h.wed, h.place)).toEqual(["It happened at Springfield"]);
    expect(labels(h.john, h.wed)).toContain("John was the groom");
    expect(labels(h.place, h.repo)).toEqual([]); // can't be tied directly
    expect(newTypesFor(records, records[h.john])).toEqual(["Person", "Family", "Event", "Source", "Citation", "Note"]);
    expect(connectOptions(records, records[h.john], standIn("Event")).map((o) => o.label)[0]).toBe("John was the main person");
  });

  it("every kind of tie shows up as yarn, and snipping it takes it away on both sides", () => {
    const { records: start, h } = loose();
    const ties: [string, string, RegExp, string][] = [
      [h.john, h.ruth, /partners/, "father"],
      [h.john, h.wed, /groom/, "groom"],
      [h.wed, h.place, /happened at/, "happened at"],
      [h.cit, h.source, /comes from/, "from"],
      [h.source, h.repo, /kept at/, "kept at"],
      [h.cit, h.wed, /evidence for/, "evidence"],
      [h.media, h.ruth, /shows/, "shows"],
      [h.note, h.wed, /note about/, "note about"],
    ];
    for (const [x, y, label, yarnLabel] of ties) {
      const tied = tie(start, x, y, label);
      const yarn = deriveYarn(tied, all(tied)).find((yy) => yy.label === yarnLabel);
      expect(yarn, `${yarnLabel} yarn after tying`).toBeTruthy();
      const b = new ChangeBuilder(tied);
      snip(b, yarn!);
      const snipped = applyChanges(tied, [b.change("snip")]);
      expect(deriveYarn(snipped, all(snipped)).find((yy) => yy.id === yarn!.id), `${yarnLabel} yarn after snipping`).toBeUndefined();
    }
  });

  it("snipping a parent takes the family off the person's own list too", () => {
    const { records: start, h } = loose();
    const tied = tie(start, h.john, h.ruth, /partners/);
    const father = deriveYarn(tied, all(tied)).find((y) => y.label === "father")!;
    const b = new ChangeBuilder(tied);
    snip(b, father);
    const after = applyChanges(tied, [b.change("snip")]);
    expect(after[h.john].family_list).toEqual([]);
    expect(after[father.owner].father_handle).toBeNull();
  });
});
