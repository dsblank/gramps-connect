import { describe, expect, it } from "vitest";
import { snippetFor } from "../searchSnippet";

describe("snippetFor", () => {
  it("shows a person's birth, death and spouse, only when profile has them", () => {
    expect(
      snippetFor("person", {
        profile: {
          gramps_id: "I0001",
          birth: { date: "12 Jan 1900", place: "Springfield" },
          death: { date: "3 Mar 1980", place: "" },
          families: [{ father: { gramps_id: "I0001" }, mother: { gramps_id: "I0002", name_display: "Jane Doe" } }],
        },
      })
    ).toEqual(["Born 12 Jan 1900 in Springfield", "Died 3 Mar 1980", "Spouse: Jane Doe"]);
    expect(snippetFor("person", { profile: { birth: {}, death: {} } })).toEqual([]);
    expect(snippetFor("person", {})).toEqual([]);
  });

  it("shows a family's parents, marriage and children", () => {
    expect(
      snippetFor("family", {
        profile: {
          father: { name_display: "John Smith" },
          mother: { name_display: "Jane Doe" },
          marriage: { date: "1 Jun 1920", place: "Boston" },
          children: [{}, {}],
        },
      })
    ).toEqual(["John Smith & Jane Doe", "Married 1 Jun 1920 in Boston · 2 children"]);
    expect(
      snippetFor("family", { profile: { father: { name_display: "John Smith" }, mother: {}, children: [] } })
    ).toEqual(["John Smith"]);
  });

  it("shows an event's date/place and up to three participants", () => {
    expect(snippetFor("event", { profile: { date: "1950", place: "Paris" } })).toEqual(["1950 at Paris"]);
    expect(
      snippetFor("event", {
        profile: {
          date: "1950",
          participants: { people: [{ person: { name_display: "A" } }, { person: { name_display: "B" } }] },
        },
      })
    ).toEqual(["1950", "With: A, B"]);
    expect(snippetFor("event", { profile: {} })).toEqual([]);
  });

  it("builds a place breadcrumb, type and coordinates", () => {
    expect(
      snippetFor("place", {
        place_type: "City",
        lat: "39.79",
        long: "-86.15",
        profile: { name: "Indianapolis", parent_places: [{ name: "Indiana" }, { name: "USA" }] },
      })
    ).toEqual(["Indianapolis › Indiana › USA", "City · 39.79, -86.15"]);
    expect(snippetFor("place", { place_type: "Unknown", profile: { name: "Springfield", parent_places: [] } })).toEqual([]);
  });

  it("reads repository from its own type/url/address, not a profile", () => {
    expect(
      snippetFor("repository", {
        type: "Web site",
        urls: [{ path: "https://example.com" }],
        address_list: [{ city: "Boston", state: "MA", country: "USA" }],
      })
    ).toEqual(["Web site · https://example.com", "Boston, MA, USA"]);
    expect(snippetFor("repository", {})).toEqual([]);
  });

  it("reads source from author/pubinfo/abbrev, not a profile", () => {
    expect(snippetFor("source", { author: "Jane Doe", pubinfo: "1990", abbrev: "JD90" })).toEqual([
      "Jane Doe · 1990",
      "(JD90)",
    ]);
    expect(snippetFor("source", { author: "", pubinfo: "" })).toEqual([]);
  });

  it("shows a citation's source title, page, date and confidence", () => {
    expect(
      snippetFor("citation", { confidence: 3, profile: { source: { title: "Wikipedia" }, page: "42", date: "2020" } })
    ).toEqual(["Wikipedia · p. 42 · 2020", "Confidence: High"]);
  });

  it("shows a media item's mime type, date and filename", () => {
    expect(snippetFor("media", { mime: "image/png", path: "abc.png", profile: { date: "2020" } })).toEqual([
      "image/png · 2020",
      "abc.png",
    ]);
    expect(snippetFor("media", { mime: "", profile: {} })).toEqual([]);
  });

  it("re-truncates a note's text longer than summaryLine's own 60-char title, and shows its Gramps note type", () => {
    const text = "a".repeat(300);
    expect(snippetFor("note", { type: "Person Note", text: { string: text } })).toEqual([
      `${"a".repeat(220)}…`,
      "Person Note",
    ]);
    expect(snippetFor("note", { text: { string: "" } })).toEqual([]);
  });

  it("shows a tag's priority only when it's a real number", () => {
    expect(snippetFor("tag", { priority: 0 })).toEqual(["Priority 0"]);
    expect(snippetFor("tag", {})).toEqual([]);
  });

  it("returns nothing for an unrecognized type", () => {
    expect(snippetFor("bogus", { anything: "here" })).toEqual([]);
  });
});
