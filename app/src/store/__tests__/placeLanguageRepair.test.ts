import { describe, expect, it, vi } from "vitest";
import type { PlaceRecord } from "../placeDisplay";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getTreeId: vi.fn().mockReturnValue(null),
  getCurrentUsername: vi.fn().mockReturnValue(null),
}));

const index = vi.hoisted(() => ({
  places: new Map<string, unknown>(),
  titles: new Map<string, string>(),
  grampsIds: new Map<string, string>(),
}));
vi.mock("../placeIndex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../placeIndex")>()),
  completePlaceIndex: () => index,
}));

import { findPlaceLanguageFixes } from "../placeLanguageRepair";

function add(handle: string, id: string, title: string, place: PlaceRecord) {
  index.places.set(handle, place);
  index.titles.set(handle, title);
  index.grampsIds.set(handle, id);
}

describe("findPlaceLanguageFixes", () => {
  it("fixes a primary name outranked by a blank-language alternate, and rebuilds titles that followed it", () => {
    add("IN", "P1", "Indiana", { name: { value: "Indiana", lang: "" }, altNames: [], type: 2, parents: [] });
    // A Wikidata replace: new "en" primary, old name kept with no language.
    add("IND", "P2", "Indianapolis, IN, Indiana", {
      name: { value: "Indianapolis", lang: "en" },
      altNames: [{ value: "Indianapolis, IN", lang: "" }],
      type: 4,
      parents: [{ ref: "IN" }],
    });
    // Below it, with a title that followed the old name...
    add("CEM", "P3", "Crown Hill, Indianapolis, IN, Indiana", {
      name: { value: "Crown Hill", lang: "" }, altNames: [], type: 0, parents: [{ ref: "IND" }],
    });
    // ...and one with a hand-written title, left alone.
    add("PARK", "P4", "My park", {
      name: { value: "Park", lang: "" }, altNames: [], type: 0, parents: [{ ref: "IND" }],
    });
    // An "en" primary with no blank-language alternate: titles already use it.
    add("OK", "P5", "Fine, Indiana", {
      name: { value: "Fine", lang: "en" }, altNames: [{ value: "Bien", lang: "fr" }], type: 4, parents: [{ ref: "IN" }],
    });

    expect(findPlaceLanguageFixes()).toEqual([
      {
        handle: "IND", grampsId: "P2", name: "Indianapolis",
        lang: { from: "en", to: "" },
        title: { from: "Indianapolis, IN, Indiana", to: "Indianapolis, Indiana" },
      },
      {
        handle: "CEM", grampsId: "P3", name: "Crown Hill",
        lang: null,
        title: { from: "Crown Hill, Indianapolis, IN, Indiana", to: "Crown Hill, Indianapolis, Indiana" },
      },
    ]);
  });
});
