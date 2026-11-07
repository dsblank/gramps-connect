// @vitest-environment jsdom
// How the surname-group lookups load: mappings on demand and on force (a
// name editor opening, the tab regaining focus), the Group as scan once,
// and a version bump only when something actually changed -- the signal a
// search already showing uses to re-run.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const responses: Record<string, unknown> = {};
const calls: string[] = [];
vi.mock("../../auth/auth", () => ({ getToken: async () => "token" }));
vi.mock("../apiFetch", () => ({
  apiFetch: vi.fn(async (url: string) => {
    const path = url.replace(/^.*\/api/, "/api");
    calls.push(path);
    return new Response(JSON.stringify(responses[path]), { status: 200 });
  }),
}));

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
});

describe("surname group loading", () => {
  it("loads mappings once, refetches on force, and drops self-mappings", async () => {
    const m = await import("../nameGroups");
    responses["/api/name-groups/"] = [
      { surname: "Smyth", group: "Smith" },
      { surname: "Jonas", group: "Jonas" },
    ];
    await m.loadNameGroupMappings();
    await m.loadNameGroupMappings();
    expect(calls).toEqual(["/api/name-groups/"]);
    expect(m.getNameGroup("Smyth")).toBe("Smith");
    expect(m.getNameGroup("Jonas")).toBeNull();
    responses["/api/name-groups/"] = [{ surname: "Smyth", group: "Smithe" }];
    await m.loadNameGroupMappings(true);
    expect(calls).toHaveLength(2);
    expect(m.getNameGroup("Smyth")).toBe("Smithe");
  });

  it("scans for names with their own Group as only once", async () => {
    const m = await import("../nameGroups");
    responses["/api/people/query/"] = { items: [{ handle: "h1", "primary_name.group_as": "Smith" }] };
    await m.loadGroupAsIndex();
    await m.loadGroupAsIndex();
    expect(calls).toEqual(["/api/people/query/"]);
    expect(m.groupSearchClauses("smith")).toEqual(['handle in ["h1"]']);
  });

  it("feeds person search's first search by starting the scan", async () => {
    const m = await import("../nameGroups");
    const { buildPersonSearchExpr } = await import("../personSearch");
    responses["/api/people/query/"] = { items: [] };
    buildPersonSearchExpr("smith");
    await m.loadGroupAsIndex();
    expect(calls).toEqual(["/api/people/query/"]);
  });
});

describe("useNameGroupsVersion", () => {
  it("changes when a lookup changes something, not on a refetch that changes nothing", async () => {
    const m = await import("../nameGroups");
    const { result } = renderHook(() => m.useNameGroupsVersion());
    const start = result.current;
    responses["/api/name-groups/"] = [{ surname: "Smyth", group: "Smith" }];
    await act(() => m.loadNameGroupMappings());
    const afterLoad = result.current;
    expect(afterLoad).not.toBe(start);
    await act(() => m.loadNameGroupMappings(true));
    expect(result.current).toBe(afterLoad);
  });
});
