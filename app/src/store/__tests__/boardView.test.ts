import { describe, expect, it } from "vitest";
import { applyChanges, ChangeBuilder } from "../board/changes";
import { addEventRef, addMediaRef, addRepoRef, cite, linkParentChild, linkPartners, newCitation, newEvent, newPerson, newPlace, newRepository, newSource, setEventPlace } from "../board/links";
import { blank, type GrampsRecord, type Records } from "../board/records";
import { deriveYarn, detailsOf, isUndatedPhoto, isUnproven, subtitleOf, titleOf, unprovenEventsOf, whatsMissing } from "../board/view";

/** The Miller case: John & Ruth's family with child Anna, their wedding (cited from
 * a source kept at a court) at Springfield, Anna's birth, and a photo of Ruth. */
function miller() {
  const start: Records = { M1: blank<GrampsRecord>("Media", { handle: "M1", gramps_id: "O1", desc: "Family portrait" }) };
  const b = new ChangeBuilder(start);
  const john = newPerson(b, { first: "John", surname: "Miller", gender: "M" });
  const ruth = newPerson(b, { first: "Ruth", surname: "Carter", gender: "F" });
  const fam = linkPartners(b, john, ruth);
  const anna = newPerson(b, { first: "Anna", surname: "Miller", gender: "F" });
  linkParentChild(b, john, anna);
  const wed = newEvent(b, "MARRIAGE", { date: blank("Date", { dateval: [14, 6, 1933, false] }) });
  addEventRef(b, fam, wed);
  const place = newPlace(b, "Springfield, Ohio");
  setEventPlace(b, wed, place);
  const source = newSource(b, "Ohio marriage records");
  const repo = newRepository(b, "Clark County Probate Court", "ARCHIVE");
  addRepoRef(b, source, repo);
  const cit = newCitation(b, source, "Vol. 92, p. 311");
  cite(b, wed, cit);
  const birth = newEvent(b, "BIRTH", { date: blank("Date", { dateval: [0, 0, 1935, false] }) });
  addEventRef(b, anna, birth);
  addMediaRef(b, ruth, "M1", [10, 10, 40, 40]);
  const records = applyChanges(start, [b.change("x")]);
  return { records, john, ruth, fam, anna, wed, place, source, repo, cit, birth };
}

describe("card titles", () => {
  it("names each kind of record the way the board shows it", () => {
    const m = miller();
    expect(titleOf(m.john, m.records)).toBe("John Miller");
    expect(titleOf(m.fam, m.records)).toBe("John & Ruth Miller");
    expect(titleOf(m.wed, m.records)).toBe("Marriage of John & Ruth");
    expect(subtitleOf(m.wed, m.records)).toBe("1933-06-14 · Springfield, Ohio");
    expect(titleOf(m.birth, m.records)).toBe("Birth of Anna");
    expect(subtitleOf(m.anna, m.records)).toBe("b. 1935");
    expect(titleOf(m.cit, m.records)).toBe("Vol. 92, p. 311");
    expect(subtitleOf(m.cit, m.records)).toBe("Ohio marriage records");
    expect(subtitleOf(m.repo, m.records)).toBe("Archive");
  });

  it("stamps an uncited event and pencils an undated photo", () => {
    const m = miller();
    expect(isUnproven(m.records[m.wed])).toBe(false);
    expect(isUnproven(m.records[m.birth])).toBe(true);
    expect(isUndatedPhoto(m.records.M1)).toBe(true);
  });

  it("counts a person's or family's events with no evidence, among those loaded", () => {
    const m = miller();
    expect(unprovenEventsOf(m.records[m.anna], m.records)).toEqual([m.birth]);
    expect(unprovenEventsOf(m.records[m.fam], m.records)).toEqual([]);
    expect(unprovenEventsOf(m.records[m.john], m.records)).toEqual([]);
    const { [m.birth]: _notLoaded, ...withoutBirth } = m.records;
    expect(unprovenEventsOf(m.records[m.anna], withoutBirth)).toEqual([]);
    expect(unprovenEventsOf(m.records[m.birth], m.records)).toEqual([]);
  });
});

describe("family group sheet", () => {
  it("lists the father, mother and every child, and counts children it can't name", () => {
    const m = miller();
    const details = detailsOf(m.fam, m.records);
    expect(details.slice(0, 3)).toEqual(["Father: John Miller", "Mother: Ruth Carter", "Children: Anna Miller"]);
    const { [m.anna]: _hidden, ...withoutAnna } = m.records;
    expect(detailsOf(m.fam, withoutAnna)[2]).toBe("Children: 1 you can't see");
  });
});

describe("yarn", () => {
  it("ties only cards that are both on the board, each family link once, coloured by kind", () => {
    const m = miller();
    const all = new Set(Object.keys(m.records));
    const yarn = deriveYarn(m.records, all);
    const labels = yarn.map((y) => `${y.label}:${y.kind}`).sort();
    expect(labels).toEqual(
      ["birth:when", "child:kin", "evidence:evidence", "father:kin", "from:evidence", "happened at:when", "kept at:evidence", "marriage:when", "mother:kin", "shows:other"].sort(),
    );
    expect(yarn.filter((y) => y.kind === "kin")).toHaveLength(3); // drawn from the family only
    const some = deriveYarn(m.records, new Set([m.john, m.fam, m.anna]));
    expect(some.map((y) => y.label).sort()).toEqual(["child", "father"]);
  });
});

describe("what's next", () => {
  it("lists a person's, family's and event's gaps", () => {
    const m = miller();
    // John: no birth, no parents. Anna has a birth and parents.
    expect(whatsMissing(m.records[m.john], m.records)).toEqual(["birth", "parents"]);
    expect(whatsMissing(m.records[m.anna], m.records)).toEqual([]);
    // The family has both partners and a marriage.
    expect(whatsMissing(m.records[m.fam], m.records)).toEqual([]);
    // The wedding has a date and a place; Anna's birth has no place.
    expect(whatsMissing(m.records[m.wed], m.records)).toEqual([]);
    expect(whatsMissing(m.records[m.birth], m.records)).toEqual(["place"]);
  });

  it("asks for a death only for someone born long ago", () => {
    const m = miller();
    expect(whatsMissing(m.records[m.anna], m.records, 2026)).toEqual([]);
    expect(whatsMissing(m.records[m.anna], m.records, 2045)).toEqual(["death"]);
  });

  it("doesn't call a birth missing while one of the person's events isn't loaded", () => {
    const m = miller();
    const { [m.birth]: _notLoaded, ...withoutBirth } = m.records;
    expect(whatsMissing(m.records[m.anna], withoutBirth)).toEqual([]);
  });

  it("asks for the other partner and the marriage of a family", () => {
    const start: Records = {};
    const b = new ChangeBuilder(start);
    const john = newPerson(b, { first: "John", surname: "Miller", gender: "M" });
    const child = newPerson(b, { first: "Anna", surname: "Miller", gender: "F" });
    linkParentChild(b, john, child);
    const records = applyChanges(start, [b.change("x")]);
    const fam = Object.values(records).find((r) => r._class === "Family")!;
    expect(whatsMissing(fam, records)).toEqual(["other partner", "marriage"]);
  });
});
