import { describe, expect, it } from "vitest";
import { formatSearchUrlState, parseSearchUrlState } from "../searchUrl";

describe("parseSearchUrlState", () => {
  it("reads q and type back out of the hash's query suffix", () => {
    expect(parseSearchUrlState("q=smith&type=person")).toEqual({ query: "smith", type: "person" });
  });

  it("reads a missing suffix (never searched) as no query and no type", () => {
    expect(parseSearchUrlState(null)).toEqual({ query: "", type: null });
  });

  it("reads a missing type as null", () => {
    expect(parseSearchUrlState("q=smith")).toEqual({ query: "smith", type: null });
  });

  it("decodes spaces and punctuation", () => {
    expect(parseSearchUrlState("q=mary%20jane%20smith")).toEqual({ query: "mary jane smith", type: null });
  });
});

describe("formatSearchUrlState", () => {
  it("encodes both fields", () => {
    expect(formatSearchUrlState({ query: "smith", type: "person" })).toBe("q=smith&type=person");
  });

  it("omits type entirely when there's no filter", () => {
    expect(formatSearchUrlState({ query: "smith", type: null })).toBe("q=smith");
  });

  it("returns null (not an empty string) for an empty/cleared search", () => {
    expect(formatSearchUrlState({ query: "", type: null })).toBeNull();
    // A type filter alone, with no query, still isn't a real search --
    // SearchView never actually reaches this (selectType only re-searches
    // when there's a live query), but the encoding itself should still be
    // consistent: nothing meaningful to restore without a query.
    expect(formatSearchUrlState({ query: "", type: "person" })).toBe("type=person");
  });

  it("round-trips through parseSearchUrlState", () => {
    const state = { query: "mary jane smith", type: "place" };
    expect(parseSearchUrlState(formatSearchUrlState(state))).toEqual(state);
  });
});
