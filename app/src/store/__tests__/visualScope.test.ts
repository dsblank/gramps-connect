import { beforeAll, describe, expect, it, vi } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { EVENT_VIEW, FAMILY_VIEW, PERSON_VIEW, PLACE_VIEW, type ViewConfig } from "../views";

vi.mock("../api", () => ({ fetchPage: vi.fn(), fetchByHandle: vi.fn() }));
vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getTreeId: vi.fn().mockReturnValue(null),
  getCurrentUsername: vi.fn().mockReturnValue(null),
}));
// resolveScope reaches for its stores through the registry; these tests
// register real, locally-loaded ViewStores in place of the app's own.
const stores = new Map<string, ViewStore>();
vi.mock("../registry", () => ({
  getViewStore: (key: string) => {
    const store = stores.get(key);
    if (!store) throw new Error(`no test store registered for ${key}`);
    return store;
  },
}));

import { fetchPage } from "../api";
import { ViewStore } from "../viewStore";
import { resolveScope, storesNeededFor } from "../visualScope";
import { EMPTY_VISUAL_DATA, type VisualData } from "../visualData";

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs();
  return sqlPromise;
}

/** Seeds one view's store from raw API-shaped items, through the ordinary
 * runQuery path -- so each ColumnConfig's own toSql runs, and these tests
 * exercise the real encoding (event_ref_list's fat ref structs reduced to a
 * comma-joined handle list) rather than a hand-written stand-in for it. */
type SeedItem = Record<string, unknown> & { handle: string };

async function register(view: ViewConfig, items: SeedItem[]): Promise<void> {
  vi.mocked(fetchPage).mockResolvedValueOnce({
    page: { items, next_after: null },
    totalCount: items.length,
  });
  const store = new ViewStore(view, getSql);
  await store.runQuery(null, false);
  stores.set(view.key, store);
}

function eventRefs(...handles: string[]) {
  return handles.map((ref) => ({
    _class: "EventRef", ref, role: { _class: "EventRoleType", string: "", value: 1 },
    private: false, attribute_list: [], citation_list: [], note_list: [],
  }));
}

function placeRefs(...handles: string[]) {
  return handles.map((ref) => ({ _class: "PlaceRef", ref }));
}

function name(first: string, surname: string) {
  return { _class: "Name", first_name: first, surname_list: [{ surname }] };
}

/** A tree shaped to exercise every branch:
 *   Wales (no coords) > Cardiff > Roath
 *   bob   born e1 @ Roath, died e2 @ Cardiff, plus e5 with no place
 *   alice born e3 @ Roath
 *   fam   married e4 @ Cardiff, parents bob + alice
 *   e9 is somebody else's event, at Roath -- the thing a scope must exclude
 */
beforeAll(async () => {
  await register(PERSON_VIEW, [
    { handle: "bob", gramps_id: "I1", surname: "Jones", given_name: "Bob", event_refs: eventRefs("e1", "e2", "e5"), family_list: ["fam"] },
    { handle: "alice", gramps_id: "I2", surname: "Vaughan", given_name: "Alice", event_refs: eventRefs("e3"), family_list: ["fam"] },
    { handle: "nemo", gramps_id: "I3", surname: "Nemo", given_name: "No", event_refs: [], family_list: [] },
  ]);
  await register(FAMILY_VIEW, [
    {
      handle: "fam", gramps_id: "F1",
      father_name: name("Bob", "Jones"), mother_name: name("Alice", "Vaughan"),
      event_refs: eventRefs("e4"), father_handle: "bob", mother_handle: "alice",
    },
  ]);
  await register(PLACE_VIEW, [
    { handle: "wales", gramps_id: "P1", title: "Wales", lat: "", long: "", enclosed_by: [] },
    { handle: "cardiff", gramps_id: "P2", title: "Cardiff", lat: "51.48", long: "-3.18", enclosed_by: placeRefs("wales") },
    { handle: "roath", gramps_id: "P3", title: "Roath", lat: "51.49", long: "-3.16", enclosed_by: placeRefs("cardiff") },
  ]);
  await register(EVENT_VIEW, [
    { handle: "e1", gramps_id: "E1", event_type: { string: "", value: 12 }, place_title: "Roath", place: "roath" },
  ]);
});

/** The indexes readVisualData would have built from the events above. Hand-
 * built here so this file tests resolveScope's own walk rather than
 * re-testing that scan (visualData.test.ts's job). */
const data: VisualData = {
  ...EMPTY_VISUAL_DATA,
  placeOfEvent: new Map([
    ["e1", "roath"], ["e2", "cardiff"], ["e3", "roath"], ["e4", "cardiff"], ["e9", "roath"],
    // e5 deliberately absent: an event with no place at all.
  ]),
  eventsByPlace: new Map([
    ["roath", ["e1", "e3", "e9"]],
    ["cardiff", ["e2", "e4"]],
  ]),
  childPlaces: new Map([
    ["wales", ["cardiff"]],
    ["cardiff", ["roath"]],
  ]),
};

describe("resolveScope: person", () => {
  it("takes the person's own events, and the places those happened at", () => {
    const scope = resolveScope({ type: "person", handle: "bob" }, data)!;
    expect(scope.label).toBe("Bob Jones");
    expect([...scope.eventHandles].sort()).toEqual(["e1", "e2", "e5"]);
    // e5 has no place, so it contributes to the timeline's half of the
    // scope but not the map's.
    expect([...scope.placeHandles].sort()).toEqual(["cardiff", "roath"]);
  });

  it("excludes other people's events at the same places", () => {
    const scope = resolveScope({ type: "person", handle: "bob" }, data)!;
    expect(scope.eventHandles.has("e9")).toBe(false);
    expect(scope.eventHandles.has("e3")).toBe(false);
  });

  it("resolves a person with no events to an empty scope, not to null", () => {
    // The views distinguish these: null means "couldn't resolve, show the
    // whole tree", empty means "resolved, and there is genuinely nothing".
    const scope = resolveScope({ type: "person", handle: "nemo" }, data)!;
    expect(scope).not.toBeNull();
    expect(scope.eventHandles.size).toBe(0);
  });

  it("returns null for a handle this cache doesn't have", () => {
    expect(resolveScope({ type: "person", handle: "ghost" }, data)).toBeNull();
  });
});

describe("resolveScope: family", () => {
  it("unions the family's own events with both parents'", () => {
    // Without the parents this would be just e4 -- one dot, which is the
    // degenerate case father_handle/mother_handle exist to avoid.
    const scope = resolveScope({ type: "family", handle: "fam" }, data)!;
    expect([...scope.eventHandles].sort()).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(scope.label).toBe("Bob Jones & Alice Vaughan");
  });
});

describe("resolveScope: place", () => {
  it("descends the containment hierarchy to the places that carry events", () => {
    // Wales itself has no events and no coordinates; everything under it
    // does. A scope that didn't descend would plot nothing.
    const scope = resolveScope({ type: "place", handle: "wales" }, data)!;
    expect([...scope.placeHandles].sort()).toEqual(["cardiff", "roath", "wales"]);
    expect([...scope.eventHandles].sort()).toEqual(["e1", "e2", "e3", "e4", "e9"]);
  });

  it("takes only what's at or under the place, not its siblings or parents", () => {
    const scope = resolveScope({ type: "place", handle: "roath" }, data)!;
    expect([...scope.placeHandles]).toEqual(["roath"]);
    expect([...scope.eventHandles].sort()).toEqual(["e1", "e3", "e9"]);
  });

  it("terminates on a cyclic containment instead of hanging", () => {
    // Gramps doesn't forbid a cycle at the data level, so the walk must not
    // depend on the hierarchy being acyclic.
    const cyclic: VisualData = {
      ...data,
      childPlaces: new Map([["wales", ["cardiff"]], ["cardiff", ["roath"]], ["roath", ["wales"]]]),
    };
    const scope = resolveScope({ type: "place", handle: "wales" }, cyclic)!;
    expect([...scope.placeHandles].sort()).toEqual(["cardiff", "roath", "wales"]);
  });
});

describe("resolveScope: event", () => {
  it("is just that event and where it happened", () => {
    const scope = resolveScope({ type: "event", handle: "e1" }, data)!;
    expect([...scope.eventHandles]).toEqual(["e1"]);
    expect([...scope.placeHandles]).toEqual(["roath"]);
    expect(scope.label).toBe("Birth — Roath");
  });
});

describe("storesNeededFor", () => {
  it("asks for nothing beyond the caches the visuals already load", () => {
    // Place and Event resolve straight out of the Places/Events caches
    // useVisualData has loaded anyway -- neither should trigger a download.
    expect(storesNeededFor({ type: "place", handle: "x" })).toEqual([]);
    expect(storesNeededFor({ type: "event", handle: "x" })).toEqual([]);
    expect(storesNeededFor(null)).toEqual([]);
  });

  it("asks for the person cache for a family, since the couple's events live there", () => {
    expect(storesNeededFor({ type: "family", handle: "x" })).toContain("person");
    expect(storesNeededFor({ type: "family", handle: "x" })).toContain("family");
  });
});
