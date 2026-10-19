import { describe, expect, it } from "vitest";
import { applyWikidataLookupResult, type WikidataLookupResult } from "../WikidataPlaceLookupDialog";

const result: WikidataLookupResult = {
  qid: "Q1726",
  label: "München",
  labelLang: "de",
  altNames: [{ value: "Munich", lang: "en" }],
  hierarchyTitle: "München, Bayern, Deutschland",
  lat: 48.137,
  long: 11.575,
  placeType: "City",
  parentHandle: "parent",
  mediaRef: null,
};

describe("applyWikidataLookupResult", () => {
  it("names a blank place by its bare label -- automatic titles add the hierarchy", () => {
    const data = applyWikidataLookupResult({}, result);
    expect(data.title).toBe("München, Bayern, Deutschland");
    expect(data.name).toEqual({ _class: "PlaceName", value: "München", lang: "de" });
    expect(data.alt_names).toEqual([{ _class: "PlaceName", value: "Munich", lang: "en" }]);
  });

  it("keeps an existing name, and any language the place already has a name in", () => {
    const data = applyWikidataLookupResult(
      {
        title: "Grandma's town",
        name: { _class: "PlaceName", value: "Grandma's town", lang: "" },
        alt_names: [{ _class: "PlaceName", value: "Munchen", lang: "en" }],
      },
      result
    );
    expect(data.title).toBeUndefined();
    expect(data.name).toBeUndefined();
    expect(data.alt_names).toEqual([{ _class: "PlaceName", value: "Munchen", lang: "en" }]);
  });
});
