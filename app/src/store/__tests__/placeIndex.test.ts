import { describe, expect, it, vi } from "vitest";
import type { ViewStore } from "../viewStore";
import {
  addFetchedPlace, attachDisplayStores, displayPlaceTitle, draftPlaceTitle, formatPlaceWith, missingEnclosingPlaces,
  placeTitleFollowsName, samplePlaceHandle,
} from "../placeIndex";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getTreeId: vi.fn().mockReturnValue(null),
  getCurrentUsername: vi.fn().mockReturnValue(null),
}));

/** A store that hasn't loaded anything yet, whose load stays in flight
 * until `finish()`. */
function unloadedStore() {
  let finish!: () => void;
  const ensureLoaded = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  const store = {
    getSnapshot: () => ({ loadedCount: 0, totalCount: 0, revision: 0, whereExpr: null, pickerExpr: null, status: "idle" }),
    ensureLoaded,
    subscribe: () => () => {},
  } as unknown as ViewStore;
  return { store, ensureLoaded, finish: () => finish() };
}

describe("loading the Places cache for display", () => {
  it("starts one load however many renders ask before it lands", async () => {
    // The Preferences tab's live examples call these on every render; each
    // extra load emitted, re-rendered, and asked again, freezing the page.
    const place = unloadedStore();
    attachDisplayStores({ place: place.store, event: unloadedStore().store });
    const fmt = { name: "Full", levels: ":", language: "", street: 0 as const, reverse: false };
    for (let i = 0; i < 5; i++) {
      expect(samplePlaceHandle()).toBeNull();
      expect(formatPlaceWith("H1", fmt)).toBeNull();
      expect(formatPlaceWith("H2", fmt)).toBeNull();
      displayPlaceTitle("H1");
    }
    expect(place.ensureLoaded).toHaveBeenCalledTimes(1);

    // Once that load has settled, a later caller may ask again (a no-op for
    // a loaded store; a retry after a failed one).
    place.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    samplePlaceHandle();
    expect(place.ensureLoaded).toHaveBeenCalledTimes(2);
  });
});

/** A fully loaded Places cache holding `rows` (handle, name, parent). */
function loadedStore(rows: [string, string, string | null][]) {
  return {
    getSnapshot: () => ({ loadedCount: rows.length, totalCount: rows.length, revision: 1, whereExpr: null, pickerExpr: null, status: "idle" }),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    subscribe: () => () => {},
    readColumns: () =>
      rows.map(([handle, name, parent]) => [
        handle, JSON.stringify({ value: name }), null, 0, parent ? JSON.stringify([{ ref: parent }]) : null,
      ]),
  } as unknown as ViewStore;
}

describe("draftPlaceTitle", () => {
  // First: once a complete index has been built the module keeps serving
  // it (see getIndex), so this has to run before the tests below.
  it("is null, not a cut-short title, before the hierarchy has loaded", () => {
    attachDisplayStores({ place: unloadedStore().store, event: unloadedStore().store });
    expect(draftPlaceTitle({ name: { value: "Indianapolis" }, placeref_list: [{ ref: "MC" }] })).toBeNull();
    expect(draftPlaceTitle({ name: { value: "Somewhere" } })).toBe("Somewhere");
  });

  it("builds from enclosing places fetched one by one when there's no complete index", () => {
    // The Places table holding a search's matches never builds the index;
    // the place editor fetches what missingEnclosingPlaces asks for.
    attachDisplayStores({ place: unloadedStore().store, event: unloadedStore().store });
    const draft = { name: { value: "Indianapolis" }, placeref_list: [{ ref: "MC" }] };
    expect(missingEnclosingPlaces(draft)).toEqual(["MC"]);
    addFetchedPlace("MC", { name: { value: "Marion County" }, placeref_list: [{ ref: "IN" }], place_type: "County" });
    expect(draftPlaceTitle(draft)).toBeNull();
    expect(missingEnclosingPlaces(draft)).toEqual(["IN"]);
    addFetchedPlace("IN", { name: { value: "Indiana" }, placeref_list: [{ ref: "GONE" }], place_type: "State" });
    // An ancestor that can't be fetched is left out rather than waited on.
    addFetchedPlace("GONE", null);
    expect(missingEnclosingPlaces(draft)).toEqual([]);
    expect(draftPlaceTitle(draft)).toBe("Indianapolis, Marion County, Indiana");
  });

  it("formats an edited name with its enclosing places, not the cached name", () => {
    attachDisplayStores({
      place: loadedStore([
        ["US", "United States", null],
        ["IN", "Indiana", "US"],
        ["MC", "Marion County", "IN"],
        ["IND", "Indy", "MC"],
      ]),
      event: unloadedStore().store,
    });
    const title = draftPlaceTitle({
      handle: "IND",
      name: { _class: "PlaceName", value: "Indianapolis" },
      place_type: "City",
      placeref_list: [{ _class: "PlaceRef", ref: "MC" }],
    });
    expect(title).toBe("Indianapolis, Marion County, Indiana, United States");
  });

  it("is just the name when the place has no enclosing place", () => {
    expect(draftPlaceTitle({ name: { value: "Somewhere" } })).toBe("Somewhere");
  });

  it("tells whether a title still follows the name or was hand-edited", () => {
    const place = { name: { value: "Indy" }, placeref_list: [{ ref: "MC" }] };
    expect(placeTitleFollowsName({ ...place, title: "" })).toBe(true);
    expect(placeTitleFollowsName({ ...place, title: "Indy" })).toBe(true);
    expect(placeTitleFollowsName({ ...place, title: "Indy, Marion County, Indiana, United States" })).toBe(true);
    expect(placeTitleFollowsName({ ...place, title: "Grandma's town" })).toBe(false);
  });

});
