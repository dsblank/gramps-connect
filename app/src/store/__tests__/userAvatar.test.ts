import { describe, expect, it } from "vitest";
import { colorForUsername, initialsFor } from "../userAvatar";

describe("colorForUsername", () => {
  it("is deterministic for the same username", () => {
    expect(colorForUsername("alice")).toBe(colorForUsername("alice"));
  });

  it("differs across usernames", () => {
    expect(colorForUsername("alice")).not.toBe(colorForUsername("bob"));
  });

  it("returns a valid hsl() string", () => {
    expect(colorForUsername("alice")).toMatch(/^hsl\(\d+, 55%, 45%\)$/);
  });
});

describe("initialsFor", () => {
  it("takes first+last letter of a resolved full name", () => {
    expect(initialsFor("Demo Editor")).toBe("DE");
  });

  it("splits a raw hyphenated username the same way", () => {
    expect(initialsFor("demo-editor")).toBe("DE");
  });

  it("splits on underscores and dots too", () => {
    expect(initialsFor("ada_lovelace")).toBe("AL");
    expect(initialsFor("ada.lovelace")).toBe("AL");
  });

  it("falls back to the first two characters for a single word", () => {
    expect(initialsFor("gramps")).toBe("GR");
  });

  it("handles a middle name by using only the first and last word", () => {
    expect(initialsFor("Ada Marie Lovelace")).toBe("AL");
  });
});
