import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apiFetch", () => ({ apiFetch: vi.fn(), setTokenRenewer: vi.fn() }));
vi.mock("../objectsApi", () => ({ fetchPlainObject: vi.fn(), updateObject: vi.fn() }));

import { apiFetch } from "../apiFetch";
import { fetchPlainObject, updateObject } from "../objectsApi";
import { reconnectPlaceChildren } from "../placeReconnect";

type Place = { handle: string; placeref_list: { _class: string; ref: string }[] };

function place(handle: string, parent?: string): Place {
  return { handle, placeref_list: parent ? [{ _class: "PlaceRef", ref: parent }] : [] };
}

/** A fake /api/places/query/ over `places`, answering the two where_expr
 * shapes reconnectPlaceChildren sends (`handle in [...]` and
 * `any(p.handle in [...] for p in enclosing_places)`), paged by `limit`
 * with a handle cursor like the real endpoint. */
function serve(places: Place[]) {
  const byHandle = new Map(places.map((p) => [p.handle, p]));
  const bodies: { where_expr: string }[] = [];
  vi.mocked(apiFetch).mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const list = [...body.where_expr.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const matches = body.where_expr.startsWith("handle in")
      ? list.filter((h) => byHandle.has(h)).map((h) => byHandle.get(h)!)
      : places.filter((p) => p.placeref_list.some((r) => list.includes(r.ref)));
    const sorted = [...matches].sort((a, b) => a.handle.localeCompare(b.handle));
    const start = body.after ? sorted.findIndex((p) => p.handle > body.after) : 0;
    const items = start < 0 ? [] : sorted.slice(start, start + body.limit);
    const more = start >= 0 && start + body.limit < sorted.length;
    return {
      ok: true,
      json: async () => ({ items, next_after: more ? items[items.length - 1].handle : null }),
    } as unknown as Response;
  });
  vi.mocked(fetchPlainObject).mockImplementation(async (_t, _v, handle) => ({ ...byHandle.get(handle)! }));
  return bodies;
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(fetchPlainObject).mockReset();
  vi.mocked(updateObject).mockReset().mockResolvedValue(undefined as never);
});

describe("reconnectPlaceChildren", () => {
  it("reattaches a child past a deleted parent *and* grandparent to the surviving ancestor", async () => {
    serve([place("ROOT"), place("COUNTY", "ROOT"), place("TOWN", "COUNTY"), place("STREET", "TOWN")]);

    await reconnectPlaceChildren("t", ["COUNTY", "TOWN"]);

    expect(updateObject).toHaveBeenCalledTimes(1);
    const [, , handle, obj] = vi.mocked(updateObject).mock.calls[0];
    expect(handle).toBe("STREET");
    expect((obj as Place).placeref_list).toEqual([{ _class: "PlaceRef", ref: "ROOT" }]);
  });

  it("finds every enclosed place past the first page of 1000 (the old single-page bug)", async () => {
    const children = Array.from({ length: 1200 }, (_, i) => place(`C${String(i).padStart(4, "0")}`, "TOWN"));
    serve([place("ROOT"), place("TOWN", "ROOT"), ...children]);

    await reconnectPlaceChildren("t", ["TOWN"]);

    expect(updateObject).toHaveBeenCalledTimes(1200);
  });

  it("looks handles up in chunks, not one huge where_expr", async () => {
    const deleted = Array.from({ length: 450 }, (_, i) => place(`D${String(i).padStart(3, "0")}`, "ROOT"));
    const bodies = serve([place("ROOT"), ...deleted]);

    await reconnectPlaceChildren("t", deleted.map((p) => p.handle));

    // 3 chunks (200 + 200 + 50) for parents, 3 for children.
    expect(bodies).toHaveLength(6);
    for (const body of bodies) {
      expect([...body.where_expr.matchAll(/'/g)].length / 2).toBeLessThanOrEqual(200);
    }
    expect(updateObject).not.toHaveBeenCalled();
  });

  it("drops the ref (new root) when the whole lineage is deleted, and leaves unrelated refs alone", async () => {
    serve([
      place("ROOT"),
      place("OTHER"),
      { handle: "CHILD", placeref_list: [{ _class: "PlaceRef", ref: "ROOT" }, { _class: "PlaceRef", ref: "OTHER" }] },
    ]);

    await reconnectPlaceChildren("t", ["ROOT"]);

    const [, , , obj] = vi.mocked(updateObject).mock.calls[0];
    expect((obj as Place).placeref_list).toEqual([{ _class: "PlaceRef", ref: "OTHER" }]);
  });
});
