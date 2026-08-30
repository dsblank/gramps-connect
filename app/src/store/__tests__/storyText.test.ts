import { describe, expect, it } from "vitest";
import { describeMoment, momentText, momentTitle, type Moment } from "../storyText";

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
