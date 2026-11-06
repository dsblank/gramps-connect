import { describe, expect, it, vi } from "vitest";
import type { ViewStore } from "../viewStore";
import { attachDisplayStores, displayPlaceTitle, draftPlaceTitle, formatPlaceWith, samplePlaceHandle } from "../placeIndex";

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
});
