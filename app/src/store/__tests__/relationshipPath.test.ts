import { describe, expect, it } from "vitest";

import {
  dropDetours,
  getRelationshipPaths,
  type PathFamily,
  type PathLink,
  type PathPerson,
  type PathSearchOptions,
  type ServerPath,
} from "../relationshipPath";

/** A small tree, one family per row:
 *
 *              GF ⚭ GM
 *            ┌────┴────┐
 *   AF ⚭ A ⚭ SF        B ⚭ BW
 *      │      │        │
 *      H      S        C ⚭ CW
 *      │ (⚭ HW)        │
 *      K ───── ⚭ ───── X
 *
 *   HWF ⚭ HWM: HW, HWB;  HWB ⚭ HWBW
 *
 * H is the "home" person; S is H's half-brother (same mother A). */
const FAMILIES: [string, string, string, string[]][] = [
  ["f-g", "GF", "GM", ["A", "B"]],
  ["f-a", "AF", "A", ["H"]],
  ["f-s", "SF", "A", ["S"]],
  ["f-b", "B", "BW", ["C"]],
  ["f-h", "H", "HW", ["K"]],
  ["f-c", "C", "CW", ["X"]],
  ["f-k", "K", "X", []],
  ["f-hw", "HWF", "HWM", ["HW", "HWB"]],
  ["f-hwb", "HWB", "HWBW", []],
];

/** What the server would say about each person relative to H (anyone
 * else: no name), and the one-link labels asked for with depth 1. */
const LABELS: Record<string, string> = {
  "H>A": "mother",
  "H>GF": "grandfather",
  "H>GM": "grandmother",
  "H>B": "uncle",
  "H>C": "first cousin",
  "H>S": "half-brother",
  "H>HW": "wife",
  "H>HWF": "father-in-law",
  "H>HWM": "mother-in-law",
  "H>HWB": "brother-in-law",
  "K>X": "wife",
  "HWB>HWBW": "wife",
};

function buildPeople(): Map<string, PathPerson> {
  const people = new Map<string, PathPerson>();
  const person = (handle: string) => {
    let p = people.get(handle);
    if (!p) {
      p = { handle, gender: 2, parent_family_list: [], extended: { parent_families: [] } };
      people.set(handle, p);
    }
    return p;
  };
  for (const [handle, father, mother, children] of FAMILIES) {
    const family: PathFamily = { handle, father_handle: father, mother_handle: mother };
    person(father).gender = 1;
    person(mother).gender = 0;
    for (const child of children) {
      person(child).parent_family_list!.push(handle);
      person(child).extended!.parent_families!.push(family);
    }
  }
  return people;
}

/** Everyone linked to `h`, the way the server's FamilyLinkGraph does it. */
function neighbors(h: string): [string, PathLink][] {
  const out: [string, PathLink][] = [];
  const add = (other: string, link: PathLink) => {
    if (other !== h && !out.some(([o, l]) => o === other && l === link)) out.push([other, link]);
  };
  for (const [, father, mother, children] of FAMILIES) {
    if (children.includes(h)) {
      add(father, "parent");
      add(mother, "parent");
    }
  }
  for (const [, father, mother, children] of FAMILIES) {
    if (father === h || mother === h) for (const c of children) add(c, "child");
  }
  for (const [, , , children] of FAMILIES) if (children.includes(h)) for (const c of children) add(c, "sibling");
  for (const [, father, mother] of FAMILIES) {
    if (father === h) add(mother, "spouse");
    if (mother === h) add(father, "spouse");
  }
  return out;
}

const isBlood = (links: PathLink[]) => /^(p)*(s)?(c)*$/.test(links.map((l) => (l === "parent" ? "p" : l === "child" ? "c" : l === "sibling" ? "s" : "x")).join(""));

/** Every simple path up to `depth` links, shortest first -- like the
 * server, detours included. */
function fakeServer() {
  const calls: { from: string; to: string; options: PathSearchOptions }[] = [];
  const fetchPaths = async (from: string, to: string, options: PathSearchOptions): Promise<ServerPath[]> => {
    calls.push({ from, to, options });
    const found: { handles: string[]; links: PathLink[] }[] = [];
    const walk = (handles: string[], links: PathLink[]) => {
      const last = handles[handles.length - 1];
      if (last === to) {
        if (!options.bloodOnly || isBlood(links)) found.push({ handles, links });
        return;
      }
      if (links.length >= options.depth) return;
      for (const [other, link] of neighbors(last)) {
        if (!handles.includes(other)) walk([...handles, other], [...links, link]);
      }
    };
    walk([from], []);
    found.sort((a, b) => a.handles.length - b.handles.length);
    return found.slice(0, options.max).map(({ handles, links }) => ({
      steps: handles.map((handle, i) => ({
        handle,
        link: i === 0 ? null : links[i - 1],
        relationship_string: i === 0 ? "" : (LABELS[`${from}>${handle}`] ?? null),
      })),
    }));
  };
  const people = buildPeople();
  const peopleRequests: string[][] = [];
  const fetchPeople = async (handles: string[]) => {
    peopleRequests.push(handles);
    return handles.flatMap((h) => (people.has(h) ? [people.get(h)!] : []));
  };
  return { calls, peopleRequests, deps: { fetchPaths, fetchPeople } };
}

const handles = (nodes: { handle: string }[]) => nodes.map((n) => n.handle);

describe("dropDetours", () => {
  it("drops a longer path through everyone a shorter one goes through", () => {
    const path = (...hs: string[]): ServerPath => ({ steps: hs.map((handle) => ({ handle, link: null, relationship_string: null })) });
    const kept = dropDetours([path("H", "B"), path("H", "F", "B"), path("H", "M", "B"), path("H", "Q", "R"), path("H", "F", "B", "N")]);
    expect(kept.map((p) => handles(p.steps))).toEqual([["H", "B"], ["H", "Q", "R"], ["H", "F", "B", "N"]]);
  });

  it("drops a detour of a detour too", () => {
    const path = (...hs: string[]): ServerPath => ({ steps: hs.map((handle) => ({ handle, link: null, relationship_string: null })) });
    const kept = dropDetours([path("A", "B"), path("A", "GF", "B"), path("A", "GF", "GM", "B")]);
    expect(kept.map((p) => handles(p.steps))).toEqual([["A", "B"]]);
  });

  it("keeps a longer path that only shares its ends with a shorter one", () => {
    const path = (...hs: string[]): ServerPath => ({ steps: hs.map((handle) => ({ handle, link: null, relationship_string: null })) });
    // A wife who is also a cousin.
    const kept = dropDetours([path("K", "X"), path("K", "H", "A", "B", "C", "X")]);
    expect(kept).toHaveLength(2);
  });
});

const labels = (nodes: { label: string }[]) => nodes.map((n) => n.label);

describe("getRelationshipPaths", () => {
  it("puts the parents above a sibling link, and drops the detours through them", async () => {
    const { deps } = fakeServer();
    const paths = await getRelationshipPaths("H", "C", deps);
    // H > A > (sibling) B > C, not the detours through GF or GM (nor
    // through GF ⚭ GM); the other path is a different connection, through
    // H's son's wife.
    expect(paths.map((p) => handles(p.steps))).toEqual([
      ["H", "A", "B", "C"],
      ["H", "K", "X", "C"],
    ]);
    const [path] = paths;
    expect(path.steps.map((s) => s.link)).toEqual([null, "parent", "sibling", "child"]);
    expect(labels(path.steps)).toEqual(["", "mother", "uncle", "first cousin"]);
    // Labelled from the detours through them.
    expect(path.steps[2].parents).toEqual([
      { handle: "GF", gender: 1, relationship_string: "grandfather", label: "grandfather" },
      { handle: "GM", gender: 0, relationship_string: "grandmother", label: "grandmother" },
    ]);
  });

  it("asks the server for an off-path ancestor's label when no path it gave names them", async () => {
    const { deps, calls } = fakeServer();
    // Only the shortest path, no detours to take labels from.
    const fetchPaths = async (from: string, to: string, options: PathSearchOptions) =>
      (await deps.fetchPaths(from, to, options)).slice(0, 1);
    const [path] = await getRelationshipPaths("H", "C", { ...deps, fetchPaths }, { maxPaths: 1 });
    expect(labels(path.steps[2].parents!)).toEqual(["grandfather", "grandmother"]);
    // No further than where they stand on this path: two links up.
    expect(calls.slice(1).map((c) => [c.to, c.options.depth])).toEqual([
      ["GF", 2],
      ["GM", 2],
    ]);
  });

  it("gives a peak its partner when both sides come down through the same family", async () => {
    const { deps } = fakeServer();
    // H's half-brother S: through A, but A ⚭ AF (H) and A ⚭ SF (S) differ.
    const [half] = await getRelationshipPaths("H", "S", deps);
    expect(handles(half.steps)).toEqual(["H", "A", "S"]);
    expect(half.steps[1].partner).toBeNull();
    // Up to a parent and down through the same family: the server gives
    // that only as a detour of the sibling link, so build one by hand --
    // P1 and P2, children of D ⚭ M, through D.
    const people = new Map([
      ["P1", { handle: "P1", parent_family_list: ["f"], extended: { parent_families: [{ handle: "f", father_handle: "D", mother_handle: "M" }] } }],
      ["P2", { handle: "P2", parent_family_list: ["f"], extended: { parent_families: [{ handle: "f", father_handle: "D", mother_handle: "M" }] } }],
      ["D", { handle: "D", gender: 1 }],
      ["M", { handle: "M", gender: 0 }],
    ]);
    const [peak] = await getRelationshipPaths(
      "P1",
      "P2",
      {
        fetchPaths: async (from, to, o) =>
          from === "P1" && to === "P2" && o.depth > 1
            ? [{ steps: [{ handle: "P1", link: null, relationship_string: "" }, { handle: "D", link: "parent", relationship_string: "father" }, { handle: "P2", link: "child", relationship_string: "brother" }] }]
            : to === "M"
              ? [{ steps: [{ handle: "P1", link: null, relationship_string: "" }, { handle: "M", link: "parent", relationship_string: "mother" }] }]
              : [],
        fetchPeople: async (hs) => hs.flatMap((h) => (people.has(h) ? [people.get(h)!] : [])),
      },
    );
    expect(peak.steps[1].partner).toEqual({ handle: "M", gender: 0, relationship_string: "mother", label: "mother" });
  });

  it("gives a spouse first, then the blood relationship", async () => {
    const { deps } = fakeServer();
    const paths = await getRelationshipPaths("K", "X", deps);
    expect(handles(paths[0].steps)).toEqual(["K", "X"]);
    expect(paths[0].steps[1]).toMatchObject({ link: "spouse", label: "wife" });
    expect(paths.some((p) => p.steps.some((s) => s.parents?.some((n) => n.handle === "GF")))).toBe(true);
  });

  it("labels in-laws in the server's words", async () => {
    const { deps } = fakeServer();
    const [path] = await getRelationshipPaths("H", "HWF", deps);
    expect(handles(path.steps)).toEqual(["H", "HW", "HWF"]);
    expect(labels(path.steps)).toEqual(["", "wife", "father-in-law"]);
  });

  it("builds a label for someone the server can't name, with the given pattern", async () => {
    const { deps, calls } = fakeServer();
    const [path] = await getRelationshipPaths("H", "HWBW", deps, { maxPaths: 1 });
    expect(handles(path.steps)).toEqual(["H", "HW", "HWB", "HWBW"]);
    expect(path.steps[3]).toMatchObject({ link: "spouse", relationship_string: "", label: "brother-in-law's wife" });
    expect(labels(path.steps[2].parents!)).toEqual(["father-in-law", "mother-in-law"]);
    // One depth-1 request for that one link.
    expect(calls.filter((c) => c.options.depth === 1)).toEqual([{ from: "HWB", to: "HWBW", options: { depth: 1, max: 1 } }]);

    const [translated] = await getRelationshipPaths("H", "HWBW", deps, { maxPaths: 1, inLawPattern: "{1} van {0}" });
    expect(translated.steps[3].label).toBe("wife van brother-in-law");
  });

  it("keeps a marriage in the middle as just its steps", async () => {
    const { deps } = fakeServer();
    // S's half-brother H's wife's father.
    const [path] = await getRelationshipPaths("S", "HWF", deps, { maxPaths: 1 });
    expect(path.steps.map((s) => s.link)).toEqual([null, "parent", "child", "spouse", "parent"]);
    expect(handles(path.steps)).toEqual(["S", "A", "H", "HW", "HWF"]);
    expect(path.steps[1].partner).toBeNull();
  });

  it("asks for room for the detours, caps depth, and passes blood_only", async () => {
    const { deps, calls } = fakeServer();
    await getRelationshipPaths("H", "C", deps, { depth: 40, maxPaths: 1, bloodOnly: true });
    expect(calls[0].options).toEqual({ depth: 15, max: 5, bloodOnly: true });
    calls.length = 0;
    await getRelationshipPaths("H", "C", deps);
    expect(calls[0].options).toEqual({ depth: 15, max: 50, bloodOnly: false });
  });

  it("keeps a blood-only search to blood relatives", async () => {
    const { deps } = fakeServer();
    expect(await getRelationshipPaths("H", "HWF", deps, { bloodOnly: true })).toEqual([]);
  });

  it("returns nothing for people who aren't connected, without loading anyone", async () => {
    const { deps, peopleRequests } = fakeServer();
    expect(await getRelationshipPaths("H", "nobody", deps)).toEqual([]);
    expect(await getRelationshipPaths("H", "C", deps, { depth: 2 })).toEqual([]);
    expect(peopleRequests).toEqual([]);
  });

  it("loads everyone on the paths in one request, plus one for the parents above", async () => {
    const { deps, peopleRequests } = fakeServer();
    await getRelationshipPaths("H", "C", deps, { maxPaths: 1 });
    expect(peopleRequests).toEqual([["H", "A", "B", "C"], ["GF", "GM"]]);
  });
});
