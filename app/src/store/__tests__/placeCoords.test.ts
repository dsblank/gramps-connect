import { describe, expect, it } from "vitest";
import { coordinateLetters, parseCoordinate, splitCoordinatePair } from "../placeCoords";
import { COORDINATE_LETTERS } from "../coordinateLetters";
import { parseCoords } from "../visualData";
import fixture from "./placeCoords.fixture.json";

// Gramps desktop's own conv_lat_lon(lat, long, "D.D8") over every
// spelling x direction letter x language, written by
// scripts/gen-coordinate-letters.py -- rerun it after a Gramps
// translation update to refresh both this and coordinateLetters.ts.
const CASES = fixture as [string, "lat" | "long", string, number | null][];

describe("parseCoordinate matches Gramps", () => {
  const byLang = new Map<string, typeof CASES>();
  for (const c of CASES) {
    if (!byLang.has(c[0])) byLang.set(c[0], []);
    byLang.get(c[0])!.push(c);
  }

  it("covers every language with letters of its own", () => {
    for (const lang of Object.keys(COORDINATE_LETTERS)) expect(byLang.has(lang)).toBe(true);
  });

  // One test per language rather than per case: thousands of tiny tests
  // would bury a real failure, and the message names the input anyway.
  it.each([...byLang.keys()])("in %s", (lang) => {
    const wrong = byLang.get(lang)!
      .map(([, kind, text, expected]) => ({ kind, text, expected, got: parseCoordinate(text, kind, lang) }))
      .filter(({ expected, got }) =>
        expected == null || got == null ? expected !== got : Math.abs(expected - got) > 1e-7);
    expect(wrong).toEqual([]);
  });
});

describe("parseCoordinate", () => {
  it("defaults to English letters", () => {
    expect(parseCoordinate("2°53'44\"W", "long")).toBeCloseTo(-2.89555556, 7);
    expect(parseCoordinate("2°53'44\"O", "long")).toBeNull();
  });

  it("reads O as west in French and east in German", () => {
    expect(parseCoordinate("2°53'44\"O", "long", "fr")).toBeCloseTo(-2.89555556, 7);
    expect(parseCoordinate("2°53'44\"O", "long", "de")).toBeCloseTo(2.89555556, 7);
  });

  it("keeps English letters working in any language", () => {
    expect(parseCoordinate("2°53'44\"W", "long", "de")).toBeCloseTo(-2.89555556, 7);
    expect(parseCoordinate("42°41'55\"S", "lat", "ru")).toBeCloseTo(-42.69861111, 7);
  });

  it("parses multi-character letters (Ukrainian, Chinese)", () => {
    expect(parseCoordinate("42°41'55\"Пд", "lat", "uk")).toBeCloseTo(-42.69861111, 7);
    expect(parseCoordinate("西经 2.8956", "long", "zh_CN")).toBeCloseTo(-2.8956, 7);
  });

  it("doesn't break Tamil latitudes on its empty south letter", () => {
    // Gramps' str.replace("", "S") would make this "S4S2S.S6S9S8S6S".
    expect(parseCoordinate("42.6986", "lat", "ta")).toBeCloseTo(42.6986, 7);
  });
});

describe("coordinateLetters", () => {
  it("falls back from a region to its base language", () => {
    expect(coordinateLetters("fr_CA")).toEqual(COORDINATE_LETTERS.fr);
  });

  it("falls back to English for a language without letters", () => {
    expect(coordinateLetters("nb")).toEqual({ N: "N", S: "S", E: "E", W: "W" });
  });

  it("drops a table that reuses an English letter for another direction", () => {
    // Czech "S" (sever) is north, so Gramps keeps English for Czech.
    expect(COORDINATE_LETTERS.cs.N).toBe("S");
    expect(coordinateLetters("cs")).toEqual({ N: "N", S: "S", E: "E", W: "W" });
  });
});

describe("parseCoords", () => {
  it("places DMS text where Gramps does, not at its whole degrees", () => {
    const [lat, long] = parseCoords("42° 41′ 55″ N", "2° 53′ 44″ E", "en")!;
    expect(lat).toBeCloseTo(42.69861111, 7);
    expect(long).toBeCloseTo(2.89555556, 7);
  });

  it("keeps a southern/western DMS sign", () => {
    const [lat, long] = parseCoords("33°52'7.68\"S", "70°40'0\"W", "en")!;
    expect(lat).toBeLessThan(0);
    expect(long).toBeLessThan(0);
  });

  it("uses the given interface language's letters", () => {
    const [, long] = parseCoords("42°41'55\"N", "2°53'44\"O", "fr")!;
    expect(long).toBeLessThan(0);
  });
});

describe("splitCoordinatePair", () => {
  it.each([
    ["42.69861, 2.89556", "42.69861", "2.89556"], // Google Maps
    ["42.6986,2.8956", "42.6986", "2.8956"],
    ["-33.8688, 151.2093", "-33.8688", "151.2093"],
    ["42,6986, 2,8956", "42.6986", "2.8956"], // decimal commas, as Gramps
    ["42° 41′ 55″ N, 2° 53′ 44″ E", "42° 41′ 55″ N", "2° 53′ 44″ E"],
    ["  42.6986 ,  2.8956  ", "42.6986", "2.8956"],
  ])("splits %j", (text, lat, long) => {
    expect(splitCoordinatePair(text)).toEqual({ lat, long });
  });

  it.each([
    "42.6986", // one value
    "42,6986", // one value with a decimal comma, not 42 / 6986
    "42,5", // ditto, though 42 / 5 would be in range
    "Perpignan, France",
    "1, 2, 3",
    "91, 2",
    "42, 181",
  ])("leaves %j to paste normally", (text) => {
    expect(splitCoordinatePair(text)).toBeNull();
  });

  it("reads letters in the given language", () => {
    expect(splitCoordinatePair("42°41'55\"N, 2°53'44\"O", "fr")).toEqual({ lat: "42°41'55\"N", long: "2°53'44\"O" });
    expect(splitCoordinatePair("42°41'55\"N, 2°53'44\"O", "en")).toBeNull();
  });
});
