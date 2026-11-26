// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadChartColorPreference, saveChartColorPreference } from "../store/chartColorPreference";
import { STORAGE_KEYS } from "../store/storageKeys";

afterEach(() => localStorage.clear());

describe("chartColorPreference", () => {
  it("defaults to each chart's usual colors", () => {
    expect(loadChartColorPreference()).toEqual({
      fan: "gen", tree: "gender", family: "none", attributeType: null, filterId: null, goql: "",
      genPalette: "original", deathPalette: "original",
    });
  });

  it("round-trips what was saved", () => {
    const pref = { fan: "tag", tree: "filter", family: "attribute", attributeType: "Level", filterId: "f1", goql: "gender == 0", genPalette: "set3", deathPalette: "viridis" };
    saveChartColorPreference(pref);
    expect(loadChartColorPreference()).toEqual(pref);
  });

  it("ignores junk and wrong types, keeping defaults for those fields", () => {
    localStorage.setItem(STORAGE_KEYS.chartColors, "{not json");
    expect(loadChartColorPreference().fan).toBe("gen");
    localStorage.setItem(STORAGE_KEYS.chartColors, JSON.stringify({ fan: 3, tree: "tag", goql: null }));
    expect(loadChartColorPreference()).toMatchObject({ fan: "gen", tree: "tag", goql: "" });
  });
});
