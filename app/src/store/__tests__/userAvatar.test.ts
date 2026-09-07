import { describe, expect, it } from "vitest";
import { bubbleColorForUsername, colorForUsername, initialsFor } from "../userAvatar";

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

describe("bubbleColorForUsername", () => {
  it("is deterministic for the same username", () => {
    expect(bubbleColorForUsername("alice")).toBe(bubbleColorForUsername("alice"));
  });

  it("returns a real Mantine color name, not a raw hsl() value", () => {
    expect(bubbleColorForUsername("alice")).toMatch(/^[a-z]+$/);
  });

  it("differs across usernames that hash to different hues", () => {
    expect(bubbleColorForUsername("alice")).not.toBe(bubbleColorForUsername("bob"));
  });

  it("shares the same underlying hue as colorForUsername, snapped to whichever named color is actually closest", () => {
    // colorForUsername("alice") is "hsl(<hue>, 55%, 45%)" -- extract that
    // hue and check it snaps to whichever of Mantine's *actual* color hues
    // (not an evenly-spaced 12-way slice of the wheel -- an earlier,
    // equal-slice version of this function snapped some hues to a color
    // over 40 degrees away from their true nearest one) is genuinely
    // closest.
    for (const name of ["alice", "bob", "gramps", "demo-editor", "member-1"]) {
      const match = colorForUsername(name).match(/^hsl\((\d+),/);
      const hue = Number(match![1]);
      const table: [string, number][] = [
        ["red", 4], ["orange", 25], ["yellow", 42], ["lime", 82], ["green", 130], ["teal", 162],
        ["cyan", 189], ["blue", 205], ["indigo", 228], ["violet", 256], ["grape", 288], ["pink", 336],
      ];
      const dist = (a: number, b: number) => Math.min(Math.abs(a - b) % 360, 360 - (Math.abs(a - b) % 360));
      const [expected] = table.reduce((best, c) => (dist(hue, c[1]) < dist(hue, best[1]) ? c : best));
      expect(bubbleColorForUsername(name)).toBe(expected);
    }
  });

  it("snaps 'gramps' (hue 86) to lime, not the far-away 'yellow' an equal-slice wheel picked", () => {
    // Regression test for the actual bug report: gramps's hue (86) sits
    // right next to lime's real hue (82) but a naive 0-360-in-12-equal-
    // slices mapping put the yellow/lime boundary at 90, so 86 fell just
    // inside the "yellow" slice despite yellow's real hue (42) being over
    // 40 degrees away -- the wrong answer looked plausible enough (still a
    // warm color) that it wasn't obviously broken by inspection.
    expect(colorForUsername("gramps")).toMatch(/^hsl\(86,/);
    expect(bubbleColorForUsername("gramps")).toBe("lime");
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
