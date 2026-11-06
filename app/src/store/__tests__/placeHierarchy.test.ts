import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../objectsApi", () => ({ fetchPlainObject: vi.fn(), updateObject: vi.fn() }));
vi.mock("../registry", () => ({ getViewStore: () => ({ requeryDebounced: vi.fn() }) }));
// Title rebuilding is placeIndex.ts's own concern (tested there); here a
// title "follows" only when blank, and rebuilds to "<name> < <parents>".
vi.mock("../placeIndex", () => ({
  placeTitleFollowsName: (data: Record<string, unknown>) => !data.title,
  draftPlaceTitle: (data: Record<string, unknown>) =>
    `${(data.name as { value: string }).value} < ${(data.placeref_list as { ref: string }[]).map((r) => r.ref).join(",")}`,
}));

import { fetchPlainObject, updateObject } from "../objectsApi";
import {
  addEnclosingPlace, insertEnclosingLevel, moveEnclosingPlace, removeEnclosingPlace, setEnclosingPlaceDate,
  wouldCreateCycle,
} from "../placeHierarchy";

type Ref = { _class: string; ref: string; date?: unknown };
type Place = { handle: string; title?: string; name: { value: string }; placeref_list: Ref[] };

let db: Map<string, Place>;

function place(handle: string, parents: (string | Ref)[] = [], title = "custom"): Place {
  return {
    handle,
    title,
    name: { value: handle },
    placeref_list: parents.map((p) => (typeof p === "string" ? { _class: "PlaceRef", ref: p } : p)),
  };
}

function serve(places: Place[]) {
  db = new Map(places.map((p) => [p.handle, p]));
  vi.mocked(fetchPlainObject).mockImplementation(async (_t, _v, handle) => structuredClone(db.get(handle)!));
  vi.mocked(updateObject).mockImplementation(async (_t, _v, handle, obj) => {
    db.set(handle, obj as unknown as Place);
  });
}

const refsOf = (h: string) => db.get(h)!.placeref_list.map((r) => r.ref);

beforeEach(() => {
  vi.mocked(fetchPlainObject).mockReset();
  vi.mocked(updateObject).mockReset();
});

describe("wouldCreateCycle", () => {
  it("rejects the place itself and anything below it, at any depth and via a second parent", async () => {
    serve([place("US"), place("IN", ["US"]), place("MARION", ["IN"]), place("INDY", ["X", "MARION"]), place("X")]);
    expect(await wouldCreateCycle("t", "INDY", "INDY")).toBe(true);
    expect(await wouldCreateCycle("t", "IN", "INDY")).toBe(true);
    expect(await wouldCreateCycle("t", "INDY", "IN")).toBe(false);
    expect(await wouldCreateCycle("t", "X", "INDY")).toBe(true);
  });
});

describe("insertEnclosingLevel", () => {
  it("turns city-in-state into city-in-county-in-state, keeping the ref's own date", async () => {
    const date = { sortval: 1, dateval: [0, 0, 1820, false] };
    serve([place("IN"), place("MARION"), place("INDY", [{ _class: "PlaceRef", ref: "IN", date }])]);

    await insertEnclosingLevel("t", "INDY", 0, "IN", "MARION");

    expect(refsOf("INDY")).toEqual(["MARION"]);
    expect(db.get("INDY")!.placeref_list[0].date).toEqual(date);
    expect(refsOf("MARION")).toEqual(["IN"]);
  });

  it("doesn't duplicate the outer place when the middle one already sits inside it", async () => {
    serve([place("IN"), place("MARION", ["IN"]), place("INDY", ["IN"])]);
    await insertEnclosingLevel("t", "INDY", 0, "IN", "MARION");
    expect(refsOf("MARION")).toEqual(["IN"]);
    expect(vi.mocked(updateObject)).toHaveBeenCalledTimes(1);
  });

  it("refuses a middle place that's inside this place, writing nothing", async () => {
    serve([place("IN"), place("INDY", ["IN"]), place("STREET", ["INDY"])]);
    await expect(insertEnclosingLevel("t", "INDY", 0, "IN", "STREET")).rejects.toThrow();
    expect(updateObject).not.toHaveBeenCalled();
  });

  it("refuses when the outer place is already inside the middle one", async () => {
    serve([place("MARION"), place("IN", ["MARION"]), place("INDY", ["IN"])]);
    await expect(insertEnclosingLevel("t", "INDY", 0, "IN", "MARION")).rejects.toThrow();
    expect(updateObject).not.toHaveBeenCalled();
  });

  it("rebuilds a following title, leaves a custom one alone", async () => {
    serve([place("IN"), place("MARION", [], ""), place("INDY", ["IN"], "")]);
    await insertEnclosingLevel("t", "INDY", 0, "IN", "MARION");
    expect(db.get("INDY")!.title).toBe("INDY < MARION");
    expect(db.get("MARION")!.title).toBe("MARION < IN");

    serve([place("IN"), place("MARION"), place("INDY", ["IN"])]);
    await insertEnclosingLevel("t", "INDY", 0, "IN", "MARION");
    expect(db.get("INDY")!.title).toBe("custom");
  });
});

describe("add/remove/move/date", () => {
  it("adds alongside, moves, sets and clears a date, removes -- by index", async () => {
    serve([place("A"), place("B"), place("C", ["A"])]);
    await addEnclosingPlace("t", "C", "B");
    expect(refsOf("C")).toEqual(["A", "B"]);

    await moveEnclosingPlace("t", "C", 1, "B", -1);
    expect(refsOf("C")).toEqual(["B", "A"]);

    const date = { sortval: 5, modifier: 0, dateval: [0, 0, 1900, false] };
    await setEnclosingPlaceDate("t", "C", 1, "A", date as never);
    expect(db.get("C")!.placeref_list[1].date).toEqual(date);
    await setEnclosingPlaceDate("t", "C", 1, "A", { modifier: 0, dateval: [0, 0, 0, false] } as never);
    expect(db.get("C")!.placeref_list[1]).not.toHaveProperty("date");

    await removeEnclosingPlace("t", "C", 0, "B");
    expect(refsOf("C")).toEqual(["A"]);
  });

  it("adding something below this place is refused", async () => {
    serve([place("A"), place("B", ["A"])]);
    await expect(addEnclosingPlace("t", "A", "B")).rejects.toThrow();
    expect(updateObject).not.toHaveBeenCalled();
  });

  it("a stale index fails instead of touching the wrong row", async () => {
    serve([place("A"), place("B"), place("C", ["A", "B"])]);
    await expect(removeEnclosingPlace("t", "C", 0, "B")).rejects.toThrow(/changed/);
    expect(updateObject).not.toHaveBeenCalled();
  });
});
