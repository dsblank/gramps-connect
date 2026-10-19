import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apiFetch", () => ({ apiFetch: vi.fn(), setTokenRenewer: vi.fn() }));

import { apiFetch } from "../apiFetch";
import { fetchBatchAncestorExpansion, fetchTreeData, type TreePersonRaw } from "../treeData";

// Cousins married: C and D share grandparents G1/G2 (pedigree collapse),
// and their child K has children K1/K2.
//   G1 + G2 -> A, B;  A -> C;  B -> D;  C + D -> K;  K -> K1, K2
function person(handle: string, parents: [string?, string?], children: string[] = []): TreePersonRaw {
  return {
    handle,
    gramps_id: `I-${handle}`,
    gender: 0,
    extended: {
      primary_parent_family: { father_handle: parents[0], mother_handle: parents[1] },
      families: children.length ? [{ handle: `F-${handle}`, child_ref_list: children.map((ref) => ({ ref })) }] : [],
    },
  };
}
const PEOPLE = new Map(
  [
    person("G1", [], ["A", "B"]),
    person("G2", [], ["A", "B"]),
    person("A", ["G1", "G2"], ["C"]),
    person("B", ["G1", "G2"], ["D"]),
    person("C", ["A"], ["K"]),
    person("D", ["B"], ["K"]),
    person("K", ["C", "D"], ["K1", "K2"]),
    person("K1", ["K"]),
    person("K2", ["K"]),
  ].map((p) => [p.handle, p]),
);

function serve(url: string): Response {
  const params = new URL(url, "http://x").searchParams;
  const id = params.get("gramps_id");
  const rows = id
    ? [...PEOPLE.values()].filter((p) => p.gramps_id === id)
    : (params.get("handles") ?? "").split(",").flatMap((h) => PEOPLE.get(h) ?? []);
  if (id && rows.length === 0) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify(rows));
}

const requested = () => vi.mocked(apiFetch).mock.calls.map(([url]) => new URL(String(url), "http://x").searchParams);
const handlesOf = (rows: TreePersonRaw[]) => rows.map((p) => p.handle).sort();

describe("tree loading by handle", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (url) => serve(String(url)));
  });

  it("fetches each ancestor generation once, even where lines rejoin", async () => {
    expect(handlesOf(await fetchTreeData("t", "I-K", 3, 0))).toEqual(["A", "B", "C", "D", "G1", "G2", "K", "K1", "K2"]);
    const handleLists = requested().map((p) => p.get("handles")).filter(Boolean);
    // C,D then A,B then G1,G2 -- the grandparents asked for once, not per line.
    expect(handleLists).toContain("C,D");
    expect(handleLists).toContain("A,B");
    expect(handleLists).toContain("G1,G2");
  });

  it("walks descendants one generation further than nDesc, as the old rule query did", async () => {
    expect(handlesOf(await fetchTreeData("t", "I-G1", 0, 1))).toEqual(["A", "B", "C", "D", "G1"]);
    expect(handlesOf(await fetchTreeData("t", "I-A", 0, 0))).toEqual(["A", "C"]);
  });

  it("returns nothing for an unknown person", async () => {
    expect(await fetchTreeData("t", "I-nobody", 3, 2)).toEqual([]);
  });

  it("expands every boundary person's parents in one request", async () => {
    const rows = await fetchBatchAncestorExpansion("t", [PEOPLE.get("C")!, PEOPLE.get("D")!]);
    expect(handlesOf(rows)).toEqual(["A", "B", "C", "D"]);
    expect(requested()).toHaveLength(1);
  });
});
