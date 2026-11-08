// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../storageKeys";

const year = { birth: "1832", death: "" };
const place = { birth: "", death: "Kirchheim" };
vi.mock("../lifeEventDates", () => ({
  lifeEventYear: (_obj: unknown, which: "birth" | "death") => year[which],
  lifeEventPlace: (_obj: unknown, which: "birth" | "death") => place[which],
}));

const {
  BUILTIN_SITES,
  engineFromSuggestion,
  fillTemplate,
  isValidSearchUrl,
  loadPrefs,
  savePrefs,
  searchTermsFor,
  SUGGESTED_SITES,
  suggestionEngineKey,
  visibleSites,
} = await import("../externalSearch");

beforeEach(() => localStorage.clear());

describe("searchTermsFor", () => {
  it("reads the raw primary name, prefix and all, and falls back to the death place", () => {
    const terms = searchTermsFor({
      handle: "h",
      primary_name: {
        first_name: "Johann Georg",
        surname_list: [{ surname: "Other" }, { prefix: "von", surname: "Schmidt", primary: true }],
      },
    });
    expect(terms).toEqual({
      name_given: "Johann Georg",
      name_middle: "Georg",
      name_surname: "von Schmidt",
      place_name: "Kirchheim",
      birth_year: "1832",
      death_year: "",
    });
  });

  it("copes with a record with no name at all", () => {
    const terms = searchTermsFor({ handle: "h" });
    expect(terms.name_given).toBe("");
    expect(terms.name_surname).toBe("");
  });
});

describe("fillTemplate", () => {
  it("URL-encodes values and blanks empty or unknown variables", () => {
    expect(fillTemplate("https://x/?q={{name_given}}&s={{name_surname}}&z={{nope}}", { name_given: "A&B #1", name_surname: "" }))
      .toBe("https://x/?q=A%26B%20%231&s=&z=");
  });

  it("produces a valid https URL for every built-in and suggested site", () => {
    for (const site of [...BUILTIN_SITES, ...SUGGESTED_SITES]) {
      expect(isValidSearchUrl(site.url)).toBe(true);
      expect(site.url.startsWith("https://")).toBe(true);
      expect(() => new URL(fillTemplate(site.url, { name_given: "Jo Ann", name_surname: "O'Neil" }))).not.toThrow();
      expect(fillTemplate(site.url, {})).not.toMatch(/\{\{/);
    }
  });
});

describe("isValidSearchUrl", () => {
  it("accepts http(s) templates only", () => {
    expect(isValidSearchUrl("https://example.com/search?name={{name_surname}}")).toBe(true);
    expect(isValidSearchUrl("javascript:alert({{name_given}})")).toBe(false);
    expect(isValidSearchUrl("example.com")).toBe(false);
    expect(isValidSearchUrl("")).toBe(false);
  });
});

describe("prefs", () => {
  it("round-trips and lists visible built-ins before custom engines", () => {
    savePrefs({ hidden: ["ancestry"], custom: [{ key: "c1", name: "Mine", url: "https://m/?q={{name_surname}}" }] });
    const prefs = loadPrefs();
    const keys = visibleSites(prefs).map((s) => s.key);
    expect(keys).not.toContain("ancestry");
    expect(keys[keys.length - 1]).toBe("c1");
    expect(keys).toHaveLength(BUILTIN_SITES.length);
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem(STORAGE_KEYS.externalSearch, "{not json");
    expect(loadPrefs()).toEqual({ hidden: [], custom: [] });
    localStorage.setItem(STORAGE_KEYS.externalSearch, JSON.stringify({ hidden: [1, "x"], custom: [{ key: "k" }] }));
    expect(loadPrefs()).toEqual({ hidden: ["x"], custom: [] });
  });
});

describe("sites", () => {
  it("has unique keys across built-ins and suggestions", () => {
    const keys = [...BUILTIN_SITES, ...SUGGESTED_SITES].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps gramps-web's keys for the sites both have, so hidden sites carry over", () => {
    const keys = BUILTIN_SITES.map((s) => s.key);
    for (const key of ["familySearch", "ancestry", "myheritage", "geneanet", "wikitree", "findagrave"]) {
      expect(keys).toContain(key);
    }
  });
});

describe("suggested sites", () => {
  it("become custom engines that keep their access level through storage", () => {
    const site = SUGGESTED_SITES[0];
    const engine = engineFromSuggestion(site);
    expect(engine).toEqual({ key: suggestionEngineKey(site), name: site.name, url: site.url, access: site.access });
    savePrefs({ hidden: [], custom: [engine, { key: "bad", name: "x", url: "https://x/", access: "free" as never }] });
    const [kept, bad] = loadPrefs().custom;
    expect(kept).toEqual(engine);
    expect(bad).toEqual({ key: "bad", name: "x", url: "https://x/" });
  });
});
