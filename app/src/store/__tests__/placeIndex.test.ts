import { describe, expect, it, vi } from "vitest";
import type { ViewStore } from "../viewStore";
import { attachDisplayStores, displayPlaceTitle, formatPlaceWith, samplePlaceHandle } from "../placeIndex";

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
