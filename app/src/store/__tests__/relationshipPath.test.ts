import { describe, expect, it } from "vitest";

import { findRelationshipChains, getRelationshipPaths, type PathFamily, type PathPerson } from "../relationshipPath";

/** A small tree, built as one family per `family()` call below:
 *
 *              GF ⚭ GM
 *            ┌────┴────┐
 *   AF ⚭ A ⚭ SF        B ⚭ BW
 *      │      │        │
 *      H      S        C ⚭ CW
 *      │ (⚭ HW)        │
 *      K ───── ⚭ ───── X (adopted)
 *
 * H is the "home" person. B is H's uncle (through GF ⚭ GM), C H's first
 * cousin, X H's first cousin once removed. K (H's child) married X: K and
 * X are related twice -- as spouses, and as second cousins via GF ⚭ GM.
 * S is H's half-brother: same mother A, a different father SF. */
function buildPeople(): Map<string, PathPerson> {
  const people = new Map<string, PathPerson>();
  const person = (handle: string) => {
    let p = people.get(handle);
    if (!p) {
      p = { handle, family_list: [], extended: {} };
      people.set(handle, p);
    }
    return p;
  };
  const family = (handle: string, father: string, mother: string, children: [string, string?][]) => {
    const fam: PathFamily = {
      father_handle: father,
      mother_handle: mother,
      child_ref_list: children.map(([ref, rel = "Birth"]) => ({ ref, frel: rel, mrel: "Birth" })),
    };
    person(father).family_list!.push(handle);
    person(father).gender = 1;
    person(mother).family_list!.push(handle);
    person(mother).gender = 0;
    for (const [ref] of children) person(ref).extended = { primary_parent_family: fam };
  };
  family("f-g", "GF", "GM", [["A"], ["B"]]);
  family("f-a", "AF", "A", [["H"]]);
  family("f-s", "SF", "A", [["S"]]);
  family("f-b", "B", "BW", [["C"]]);
  family("f-h", "H", "HW", [["K"]]);
  family("f-c", "C", "CW", [["X", "Adopted"]]);
  family("f-k", "K", "X", []);
  family("f-hw", "HWF", "HWM", [["HW"], ["HWB"]]);
  family("f-hwb", "HWB", "HWBW", []);
  return people;
}

function fakeDeps(people: Map<string, PathPerson>) {
  const requests: string[][] = [];
  return {
    requests,
    fetchPeople: async (handles: string[]) => {
      requests.push(handles);
      return handles.flatMap((h) => (people.has(h) ? [people.get(h)!] : []));
    },
    fetchRelationships: async (h1: string, h2: string) => [
      { relationship_string: `rel(${h1},${h2})`, common_ancestors: [] as string[] },
    ],
    // Spouses: whoever shares one of this person's families as a parent.
    fetchSpouses: async (handle: string) => {
      const mine = new Set(people.get(handle)?.family_list ?? []);
      const spouses = [...people.values()]
        .filter((p) => p.handle !== handle && (p.family_list ?? []).some((f) => mine.has(f)))
        .map((p) => p.handle);
      return { gender: people.get(handle)?.gender ?? 2, spouses };
    },
  };
}

describe("findRelationshipChains", () => {
  it("goes up to the ancestor couple and back down, as one path", async () => {
    const deps = fakeDeps(buildPeople());
    const [path, ...rest] = await findRelationshipChains("H", "X", deps);
    expect(rest).toEqual([]);
    expect(path.handles).toEqual(["H", "A", "GM", "B", "C", "X"]);
    // GM before GF: mother-line wins the tie-break, as in the addon.
    expect(path.commonAncestors).toEqual(["GM", "GF"]);
    expect(path.handles[path.top]).toBe("GM");
  });

  it("finds a direct ancestor with no detour", async () => {
    const deps = fakeDeps(buildPeople());
    const [path] = await findRelationshipChains("H", "GF", deps);
    expect(path.handles).toEqual(["H", "A", "GF"]);
    expect(path.commonAncestors).toEqual(["GF"]);
  });

  it("goes through the one shared parent for a half-sibling", async () => {
    const deps = fakeDeps(buildPeople());
    const [path] = await findRelationshipChains("H", "S", deps);
    expect(path.handles).toEqual(["H", "A", "S"]);
    expect(path.commonAncestors).toEqual(["A"]);
  });

  it("reports a spouse first, then the blood relationship", async () => {
    const deps = fakeDeps(buildPeople());
    const paths = await findRelationshipChains("K", "X", deps);
    expect(paths.map((p) => p.handles)).toEqual([
      ["K", "X"],
      ["K", "H", "A", "GM", "B", "C", "X"],
    ]);
    expect(paths[0].commonAncestors).toEqual([]);
  });

  it("returns nothing for unrelated people, or ones beyond depth", async () => {
    const deps = fakeDeps(buildPeople());
    expect(await findRelationshipChains("H", "CW", deps)).toEqual([]);
    // depth counts the person themselves, like Gramps: depth 2 = parents only.
    expect(await findRelationshipChains("H", "GF", deps, { depth: 2 })).toEqual([]);
    expect(await findRelationshipChains("H", "GF", deps, { depth: 3 })).toHaveLength(1);
  });

  it("stops early for maxPaths 1 with the same nearest path", async () => {
    const people = buildPeople();
    // Give GF and GM a long line of ancestors that a full walk would load.
    let child = "GF";
    for (let i = 0; i < 10; i++) {
      const fam = { father_handle: `GF${i}`, mother_handle: `GM${i}`, child_ref_list: [{ ref: child, frel: "Birth", mrel: "Birth" }] };
      people.get(child)!.extended = { primary_parent_family: fam };
      people.set(`GF${i}`, { handle: `GF${i}`, family_list: [] });
      people.set(`GM${i}`, { handle: `GM${i}`, family_list: [] });
      child = `GF${i}`;
    }
    const full = fakeDeps(people);
    const quick = fakeDeps(people);
    const [fullPath] = await findRelationshipChains("H", "S", full);
    const [quickPath] = await findRelationshipChains("H", "S", quick, { maxPaths: 1 });
    expect(quickPath).toEqual(fullPath);
    expect(quick.requests.length).toBeLessThan(full.requests.length);
  });

  it("loads each generation of both sides in one request", async () => {
    const deps = fakeDeps(buildPeople());
    await findRelationshipChains("H", "X", deps);
    // The two people, then one request per generation walked -- nothing
    // for a generation whose people are already loaded.
    expect(deps.requests).toEqual([
      ["H", "X"],
      ["AF", "A", "C", "CW"],
      ["GF", "GM", "B", "BW"],
    ]);
  });
});

describe("getRelationshipPaths", () => {
  it("labels each person from the entry going through this path's ancestor", async () => {
    const deps = {
      ...fakeDeps(buildPeople()),
      fetchRelationships: async (_h1: string, h2: string) =>
        h2 === "X"
          ? [
              { relationship_string: "wife", common_ancestors: [] },
              { relationship_string: "second cousin", common_ancestors: ["GF", "GM"] },
            ]
          : [{ relationship_string: `rel-${h2}`, common_ancestors: [h2] }],
    };
    const [spouse, blood] = await getRelationshipPaths("K", "X", deps);
    expect(spouse.people).toEqual([
      { handle: "K", relationship_string: "", gender: 1 },
      { handle: "X", relationship_string: "wife", gender: 0 },
    ]);
    expect(spouse.partner).toBeNull();
    expect(blood.people.map((p) => p.relationship_string)).toEqual([
      "",
      "rel-H",
      "rel-A",
      "rel-GM",
      "rel-B",
      "rel-C",
      "second cousin",
    ]);
    // The couple's other spouse, labelled through themselves.
    expect(blood.common_ancestors).toEqual(["GM", "GF"]);
    expect(blood.partner).toEqual({ handle: "GF", relationship_string: "rel-GF", gender: 1 });
  });
});

describe("in-law paths", () => {
  it("go through the first person's spouse: wife, then her father", async () => {
    const [path, ...rest] = await getRelationshipPaths("H", "HWF", fakeDeps(buildPeople()));
    expect(rest).toEqual([]);
    expect(path.people.map((p) => [p.handle, p.relationship_string])).toEqual([
      ["H", ""],
      ["HW", "rel(H,HW)"],
      // Relative to HW, not H: the chart reads it as "wife's father".
      ["HWF", "rel(HW,HWF)"],
    ]);
    expect(path.via).toEqual([{ handle: "HW", married_to: "H" }]);
    expect(path.common_ancestors).toEqual(["HWF"]);
  });

  it("go through the last person's spouse: a cousin, then his wife", async () => {
    const [path] = await getRelationshipPaths("H", "CW", fakeDeps(buildPeople()));
    expect(path.people.map((p) => p.handle)).toEqual(["H", "A", "GM", "B", "C", "CW"]);
    expect(path.people[path.people.length - 1].relationship_string).toBe("rel(C,CW)");
    expect(path.via).toEqual([{ handle: "C", married_to: "CW" }]);
  });

  it("aren't looked for when there's a blood relationship or a marriage", async () => {
    const deps = fakeDeps(buildPeople());
    let asked = 0;
    const counting = { ...deps, fetchSpouses: async (h: string) => (asked++, deps.fetchSpouses(h)) };
    expect((await getRelationshipPaths("H", "X", counting))[0].via).toEqual([]);
    expect((await getRelationshipPaths("K", "X", counting))[0].via).toEqual([]);
    expect(asked).toBe(0);
  });

  it("go through a marriage at both ends: wife's brother's wife", async () => {
    const [path, ...rest] = await getRelationshipPaths("H", "HWBW", fakeDeps(buildPeople()));
    expect(rest).toEqual([]);
    expect(path.people.map((p) => [p.handle, p.relationship_string])).toEqual([
      ["H", ""],
      ["HW", "rel(H,HW)"],
      ["HWM", "rel(HW,HWM)"],
      ["HWB", "rel(HW,HWB)"],
      ["HWBW", "rel(HWB,HWBW)"],
    ]);
    expect(path.via).toEqual([
      { handle: "HW", married_to: "H" },
      { handle: "HWB", married_to: "HWBW" },
    ]);
    expect(path.common_ancestors).toEqual(["HWM", "HWF"]);
  });

  it("leave out spouse-of-a-spouse and someone married to both", async () => {
    const people = buildPeople();
    // HW also married Z: H and Z both married HW -- not in-laws, as in
    // Gramps' All Relations.
    people.get("HW")!.family_list!.push("f-z");
    people.set("Z", { handle: "Z", gender: 1, family_list: ["f-z"] });
    expect(await getRelationshipPaths("H", "Z", fakeDeps(people))).toEqual([]);
  });

  it("still find nothing for people with no connection at all", async () => {
    // HW's father and C's wife: neither, nor their spouses, share blood.
    expect(await getRelationshipPaths("HWF", "CW", fakeDeps(buildPeople()))).toEqual([]);
  });

  it("find a marriage at both ends even between people far apart: wife's nephew's wife", async () => {
    // AF ⚭ A, A is C's aunt, C ⚭ CW.
    const [path] = await getRelationshipPaths("AF", "CW", fakeDeps(buildPeople()));
    expect(path.people.map((p) => p.handle)).toEqual(["AF", "A", "GM", "B", "C", "CW"]);
    expect(path.via).toEqual([
      { handle: "A", married_to: "AF" },
      { handle: "C", married_to: "CW" },
    ]);
  });
});
