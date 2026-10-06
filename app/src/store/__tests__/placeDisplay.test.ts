import { describe, expect, it } from "vitest";
import { Modifier, parseDate, type GrampsDate } from "@gramps-connect/gramps-date";
import { formatPlace, type PlaceRecord } from "../placeDisplay";
import { FULL_PLACE_FORMAT, type PlaceFormatDef } from "../displaySettings";

const EMPTY: GrampsDate = parseDate("");

function place(name: string, type: number, parent?: string, extra: Partial<PlaceRecord> = {}): PlaceRecord {
  return { name: { value: name, lang: "", date: EMPTY }, altNames: [], type, parents: parent ? [{ ref: parent, date: EMPTY }] : [], ...extra };
}

// number -> street -> city -> county -> state -> country
const PLACES: Record<string, PlaceRecord> = {
  num: place("12", 20, "street"),
  street: place("Main St", 7, "city"),
  city: place("Springfield", 4, "county"),
  county: place("Sangamon County", 3, "state"),
  state: place("Illinois", 2, "country"),
  country: place("USA", 1),
};
const lookup = (h: string) => PLACES[h];

function fmt(levels: string, extra: Partial<PlaceFormatDef> = {}): PlaceFormatDef {
  return { ...FULL_PLACE_FORMAT, name: "t", levels, ...extra };
}

describe("formatPlace", () => {
  it("Full joins the whole hierarchy", () => {
    expect(formatPlace(lookup, "city", FULL_PLACE_FORMAT)).toBe("Springfield, Sangamon County, Illinois, USA");
  });

  it("returns null for an unknown place", () => {
    expect(formatPlace(lookup, "nope", FULL_PLACE_FORMAT)).toBeNull();
  });

  it("slices levels like Python", () => {
    expect(formatPlace(lookup, "city", fmt("0"))).toBe("Springfield");
    expect(formatPlace(lookup, "city", fmt("0:2"))).toBe("Springfield, Sangamon County");
    expect(formatPlace(lookup, "city", fmt("-1"))).toBe("USA");
    expect(formatPlace(lookup, "city", fmt(":-1"))).toBe("Springfield, Sangamon County, Illinois");
    expect(formatPlace(lookup, "city", fmt("0,-1"))).toBe("Springfield, USA");
    expect(formatPlace(lookup, "city", fmt("9"))).toBe("");
  });

  it("p offsets count from the populated place", () => {
    // From the street: [Main St, Springfield(p), county, state, country]
    expect(formatPlace(lookup, "street", fmt("p:"))).toBe("Springfield, Sangamon County, Illinois, USA");
    expect(formatPlace(lookup, "street", fmt("p0,-1"))).toBe("Springfield, USA");
    // No populated place in the chain: "p" isn't a number -> open bound.
    expect(formatPlace(lookup, "county", fmt("p1:"))).toBe("Sangamon County, Illinois, USA");
  });

  it("merges a house number with its street", () => {
    expect(formatPlace(lookup, "num", fmt(":", { street: 1 }))).toBe("12 Main St, Springfield, Sangamon County, Illinois, USA");
    expect(formatPlace(lookup, "num", fmt("0:2", { street: 2 }))).toBe("Main St 12");
  });

  it("reverses", () => {
    expect(formatPlace(lookup, "city", fmt("0:2", { reverse: true }))).toBe("Sangamon County, Springfield");
  });

  it("picks names and parents by date and language", () => {
    const before1900: GrampsDate = { ...parseDate("1900"), modifier: Modifier.BEFORE };
    before1900.sortval = parseDate("1900").sortval;
    const places: Record<string, PlaceRecord> = {
      town: place("Kingston", 15, "colony", {
        altNames: [
          { value: "Kingstown", lang: "", date: before1900 },
          { value: "Königsstadt", lang: "de", date: EMPTY },
        ],
        parents: [{ ref: "colony", date: before1900 }, { ref: "nation", date: EMPTY }],
      }),
      colony: place("Colony", 9),
      nation: place("Nation", 1),
    };
    const lk = (h: string) => places[h];
    const old = parseDate("1850");
    // In 1850 the primary name (undated) matches first; the dated parent too.
    expect(formatPlace(lk, "town", FULL_PLACE_FORMAT, old)).toBe("Kingston, Colony");
    expect(formatPlace(lk, "town", FULL_PLACE_FORMAT, parseDate("1950"))).toBe("Kingston, Nation");
    expect(formatPlace(lk, "town", fmt(":", { language: "de" }), parseDate("1950"))).toBe("Königsstadt, Nation");
  });

  it("stops at a cycle", () => {
    const cyc: Record<string, PlaceRecord> = { a: place("A", 4, "b"), b: place("B", 3, "a") };
    expect(formatPlace((h) => cyc[h], "a", FULL_PLACE_FORMAT)).toBe("A, B");
  });
});
