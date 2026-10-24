import { describe, expect, it } from "vitest";
import { describeMoment, isBookkeepingEvent, momentText, momentTitle, storyDescription, storyPhotoCaption, storyPhotoCredit, storyPlaceName, type Moment } from "../storyText";

function moment(over: Partial<Moment> = {}): Moment {
  return {
    type: "Birth",
    subjects: ["Anna Schmidt"],
    dateText: "",
    datePreposition: "",
    placeTitle: "",
    description: "",
    ...over,
  };
}

describe("momentText", () => {
  it("puts a full date behind 'on' and a year behind 'in'", () => {
    expect(momentText(moment({ dateText: "3 Mar 1854", datePreposition: "on" })))
      .toBe("Anna Schmidt was born on 3 Mar 1854.");
    expect(momentText(moment({ dateText: "1854", datePreposition: "in" })))
      .toBe("Anna Schmidt was born in 1854.");
  });

  it("leaves a modified date to speak for itself", () => {
    // visualData.ts hands these through with no preposition, since
    // "about 1854" / "between 1920 and 1930" are already phrases.
    expect(momentText(moment({ dateText: "about 1854" })))
      .toBe("Anna Schmidt was born about 1854.");
    expect(momentText(moment({ type: "Death", dateText: "between 1920 and 1930" })))
      .toBe("Anna Schmidt died between 1920 and 1930.");
  });

  it("uses the plural phrase for a couple's own event", () => {
    expect(momentText(moment({
      type: "Marriage", subjects: ["Hans Meyer", "Anna Schmidt"],
      dateText: "5 Jun 1878", datePreposition: "on", placeTitle: "St. Mary's, Bremen",
    }))).toBe("Hans Meyer and Anna Schmidt were married on 5 Jun 1878 in St. Mary's, Bremen.");
  });

  it("falls back to a noun form for a type it has no phrase for", () => {
    expect(momentText(moment({ type: "Occupation", dateText: "1880", datePreposition: "in" })))
      .toBe("Occupation of Anna Schmidt in 1880.");
    // A custom event type lands here too, whatever the tree's author called it.
    expect(momentText(moment({ type: "Apprenticeship" })))
      .toBe("Apprenticeship of Anna Schmidt.");
  });

  it("keeps the author's description as a second sentence", () => {
    expect(momentText(moment({ dateText: "1854", datePreposition: "in", description: "Second daughter" })))
      .toBe("Anna Schmidt was born in 1854. Second daughter.");
  });

  it("drops a description that only repeats the event type", () => {
    // What a GEDCOM import routinely leaves behind.
    expect(momentText(moment({ type: "Death", description: "death" })))
      .toBe("Anna Schmidt died.");
  });

  it("says a non-subject role took part rather than claiming the event", () => {
    expect(momentText(moment({ type: "Baptism", role: "Witness", placeTitle: "Kirchweg" })))
      .toBe("Anna Schmidt took part in this Baptism as Witness in Kirchweg.");
  });

  it("treats the role a Family carries on its own events as the subject's", () => {
    expect(momentText(moment({ type: "Divorce", subjects: ["Hans Meyer", "Anna Schmidt"], role: "Family" })))
      .toBe("Hans Meyer and Anna Schmidt were divorced.");
  });

  it("is never empty, even with nothing but a type", () => {
    expect(momentText(moment({ subjects: [] }))).toBe("Birth.");
  });
});

describe("momentTitle", () => {
  it("names the subject so a family story's slides aren't all 'Birth'", () => {
    expect(momentTitle(moment({ subjects: ["Josef Meyer"] }))).toBe("Birth of Josef Meyer");
    expect(momentTitle(moment({ type: "Marriage", subjects: ["Hans Meyer", "Anna Schmidt"] })))
      .toBe("Marriage of Hans Meyer & Anna Schmidt");
  });

  it("names the role instead when the event isn't the subject's own", () => {
    expect(momentTitle(moment({ type: "Baptism", role: "Witness" }))).toBe("Baptism (Witness)");
  });

  it("falls back to the bare type with nobody to name", () => {
    expect(momentTitle(moment({ subjects: [] }))).toBe("Birth");
  });
});

describe("describeMoment", () => {
  it("returns both seeded fields", () => {
    expect(describeMoment(moment({ dateText: "1854", datePreposition: "in" })))
      .toEqual({ title: "Birth of Anna Schmidt", text: "Anna Schmidt was born in 1854." });
  });
});

describe("relation", () => {
  it("says who a relative is before naming them", () => {
    expect(momentText(moment({ subjects: ["George V Windsor"], relation: "His father", dateText: "1865", datePreposition: "in" })))
      .toBe("His father, George V Windsor, was born in 1865.");
    expect(momentText(moment({ type: "Marriage", subjects: ["George V", "Mary of Teck"], relation: "His parents" })))
      .toBe("His parents, George V and Mary of Teck, were married.");
  });
});

describe("storyPlaceName", () => {
  it("drops empty levels, codes, and a level that repeats the one before it", () => {
    expect(storyPlaceName(", Florence, , Florence, Tuscany, Italy")).toBe("Florence, Tuscany, Italy");
    expect(storyPlaceName("Château, Pau, 64445, Pyrénées-Atlantiques, FRANCE")).toBe("Château, Pau, Pyrénées-Atlantiques, FRANCE");
    // A house number is part of its street, not a level of its own.
    expect(storyPlaceName("17 Bruton St., London")).toBe("17 Bruton St., London");
  });

  it("is used in the sentence", () => {
    expect(momentText(moment({ placeTitle: ", Florence, , Florence, Italy" }))).toBe("Anna Schmidt was born in Florence, Italy.");
  });
});

describe("storyDescription", () => {
  it("drops footnote markers copied from Wikipedia", () => {
    expect(storyDescription("Died at Balmoral,[ 124 ] aged 96.[a][citation needed]")).toBe("Died at Balmoral, aged 96.");
    expect(storyDescription("from old age , prompting Operation Unicorn .")).toBe("from old age, prompting Operation Unicorn.");
  });

  it("cuts a long description to its first sentence", () => {
    const long = `On the afternoon of 8 September 2022, at 3:10 p.m. local time, she died at Balmoral Castle. ${"More detail. ".repeat(20)}`;
    expect(storyDescription(long)).toBe("On the afternoon of 8 September 2022, at 3:10 p.m. local time, she died at Balmoral Castle.");
  });
});

describe("storyPhotoCaption", () => {
  it("keeps a written description as it is", () => {
    expect(storyPhotoCaption("Queen Mary in 1911")).toBe("Queen Mary in 1911");
  });

  it("tidies one that's a file name", () => {
    expect(storyPhotoCaption("King_George_1923_LCCN2014715558_(cropped).jpg")).toBe("King George 1923");
    expect(storyPhotoCaption("York_Cottage")).toBe("York Cottage");
  });

  it("gives no caption for a camera's file name", () => {
    expect(storyPhotoCaption("IMG_2041.JPG")).toBe("");
    expect(storyPhotoCaption("DSC01234")).toBe("");
  });
});

describe("storyPhotoCredit", () => {
  it("uses a Credit attribute as written", () => {
    expect(storyPhotoCredit([{ type: "Credit", value: "© Jane Smith" }, { type: "Author", value: "Someone else" }])).toBe("© Jane Smith");
  });

  it("otherwise joins who made it, its licence and its source", () => {
    expect(storyPhotoCredit([
      { type: "Source", value: "Wikimedia Commons" },
      { type: { string: "Photographer" }, value: "John Fielding" },
      { type: "License", value: "CC BY 2.0" },
    ])).toBe("John Fielding · CC BY 2.0 · Wikimedia Commons");
  });

  it("is empty when the photo has none of these", () => {
    expect(storyPhotoCredit([{ type: "Nickname", value: "x" }])).toBe("");
  });
});

describe("isBookkeepingEvent", () => {
  it("is a vendor tag, or a custom type with nothing to show", () => {
    expect(isBookkeepingEvent("_UPD", false, true, false)).toBe(true);
    expect(isBookkeepingEvent("Reference Number", false, false, false)).toBe(true);
    expect(isBookkeepingEvent("Reference Number", false, true, false)).toBe(false);
    expect(isBookkeepingEvent("Baptism", true, false, false)).toBe(false);
  });
});
