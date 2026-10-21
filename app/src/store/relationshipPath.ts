// The chain of people connecting two people through a common ancestor --
// what gramps-web-api's /relations/ endpoint can't give (it returns the
// wording and the common ancestors, never the people in between). Ported
// from the FastRelationshipGraph addon's relationship_path()/
// all_relationship_paths() (gramps-project/addons-source#1036): a
// visited-once ancestor walk from each person, intersected. Two changes
// from that version: each generation's parents are fetched in one batched
// request instead of one person and one family at a time, and an ancestor
// couple is reported as one path with both of them in commonAncestors,
// not as two near-identical paths (one through each spouse).
//
// Labels are left to the server: each person on a path is described by
// gramps-web-api's own /relations/<h1>/<node>/all, which runs Gramps' real
// relationship calculator in the user's language. Pure module with the
// network calls injected (RelationshipPathDeps), so it runs in the
// Gramplet worker (pyodideWorker.ts) and in tests alike.

export interface PathChildRef {
  ref: string;
  frel?: string;
  mrel?: string;
}

export interface PathFamily {
  father_handle?: string | null;
  mother_handle?: string | null;
  child_ref_list?: PathChildRef[];
}

/** The fields this module reads off GET /api/people/?handles=...
 * &extend=primary_parent_family: `family_list` (families this person is a
 * parent in -- only read for the two endpoints, to spot a spouse) and the
 * main parent family Gramps' own calculator follows. */
export interface PathPerson {
  handle: string;
  gender?: number;
  family_list?: string[];
  extended?: { primary_parent_family?: PathFamily | null };
}

/** One entry of /api/relations/<h1>/<h2>/all. */
export interface ServerRelationship {
  relationship_string?: string;
  common_ancestors?: string[];
}

export interface RelationshipPathDeps {
  /** Every person named that exists; missing handles are just left out. */
  fetchPeople(handles: string[]): Promise<PathPerson[]>;
  fetchRelationships(handle1: string, handle2: string): Promise<ServerRelationship[]>;
  /** A person's gender and everyone they have a family with as a parent --
   * for in-law paths; without it, only blood relatives and spouses are
   * found. */
  fetchSpouses?(handle: string): Promise<{ gender: number; spouses: string[] }>;
}

export interface PathNode {
  handle: string;
  /** This person's relationship to the path's first person ("" for that
   * person themselves). */
  relationship_string: string;
  /** Gramps' Person.gender: 0 female, 1 male, 2 unknown, 3 other. */
  gender: number;
}

export interface RelationshipPath {
  /** From the first person to the second, inclusive, up through
   * commonAncestors[0] and back down. */
  people: PathNode[];
  /** The ancestor the path goes through, then their spouse when both are
   * common ancestors through the same family. Empty for spouses. */
  common_ancestors: string[];
  /** That spouse (common_ancestors[1]), labelled like the people on the
   * path -- they aren't one of them, but a chart draws them beside
   * common_ancestors[0]. Null when there's a single common ancestor. */
  partner: PathNode | null;
  /** For an in-law path, the marriage it goes through: `handle` is the
   * first person's spouse ("wife", then her father) or the last person's
   * spouse ("brother", then his wife), and `married_to` the end of the
   * path married to them. Everyone after `handle` in `people`, and
   * `partner` when it's on that side, is labelled relative to `handle`,
   * not to the first person -- so "father" there reads "wife's father".
   * Null for a blood relative or a spouse. */
  via: { handle: string; married_to: string } | null;
}

interface AncestorMap {
  dist: Map<string, number>;
  /** Path code from the start person, one character per generation:
   * f/m a birth father/mother, F/M any other relation (adopted, step...). */
  path: Map<string, string>;
  prev: Map<string, string | null>;
  /** `${child}\n${parent}` -> that family's other parent. */
  partner: Map<string, string>;
}

const partnerKey = (child: string, parent: string) => `${child}\n${parent}`;

function newAncestorMap(handle: string): AncestorMap {
  return {
    dist: new Map([[handle, 0]]),
    path: new Map([[handle, ""]]),
    prev: new Map([[handle, null]]),
    partner: new Map(),
  };
}

/** Parents of one already-fetched person, in the order the Python version
 * visits them (father, then mother), with their path codes. Records the
 * couple in `map.partner` as a side effect. */
function parentsOf(map: AncestorMap, person: PathPerson | undefined): [string, string][] {
  const family = person?.extended?.primary_parent_family;
  if (!person || !family) return [];
  const childRef = family.child_ref_list?.find((cr) => cr.ref === person.handle);
  if (!childRef) return [];
  const fh = family.father_handle || null;
  const mh = family.mother_handle || null;
  if (fh && mh) {
    map.partner.set(partnerKey(person.handle, fh), mh);
    map.partner.set(partnerKey(person.handle, mh), fh);
  }
  const out: [string, string][] = [];
  if (fh) out.push([fh, childRef.frel === "Birth" ? "f" : "F"]);
  if (mh) out.push([mh, childRef.mrel === "Birth" ? "m" : "M"]);
  return out;
}

function advance(map: AncestorMap, frontier: string[], depth: number, people: Map<string, PathPerson>): string[] {
  const next: string[] = [];
  for (const h of frontier) {
    for (const [parent, code] of parentsOf(map, people.get(h))) {
      if (map.dist.has(parent)) continue;
      map.dist.set(parent, depth);
      map.path.set(parent, map.path.get(h)! + code);
      map.prev.set(parent, h);
      next.push(parent);
    }
  }
  return next;
}

const isBirthPath = (path: string) => !/[FMA]/.test(path);
const CODE_RANK: Record<string, number> = { m: 0, f: 1, M: 2, F: 3 };

/** Nearest total distance first; then a direct relation, then birth-only
 * lines, then mother-line before father-line; finally the handle, so ties
 * always break the same way. */
function compareAncestors(a: AncestorMap, b: AncestorMap, x: string, y: string): number {
  const key = (h: string): (number | string)[] => {
    const p1 = a.path.get(h)!;
    const p2 = b.path.get(h)!;
    const d1 = a.dist.get(h)!;
    const d2 = b.dist.get(h)!;
    return [
      d1 + d2,
      d1 === 0 || d2 === 0 ? 0 : 1,
      isBirthPath(p1) && isBirthPath(p2) ? 0 : 1,
      p1 ? (CODE_RANK[p1[p1.length - 1]] ?? -1) : -1,
      p2 ? (CODE_RANK[p2[p2.length - 1]] ?? -1) : -1,
      h,
    ];
  };
  const kx = key(x);
  const ky = key(y);
  for (let i = 0; i < kx.length; i++) {
    if (kx[i] < ky[i]) return -1;
    if (kx[i] > ky[i]) return 1;
  }
  return 0;
}

/** Drops a common ancestor that sits behind a nearer one on both people's
 * routes to it -- the same ancestor reached again further up one line, not
 * a separate relationship. */
function nearestCommonAncestors(common: string[], a: AncestorMap, b: AncestorMap): string[] {
  return common.filter((far) => {
    const p1 = a.path.get(far)!;
    const p2 = b.path.get(far)!;
    return !common.some((near) => {
      if (near === far) return false;
      const q1 = a.path.get(near)!;
      const q2 = b.path.get(near)!;
      return q1.length < p1.length && q2.length < p2.length && p1.startsWith(q1) && p2.startsWith(q2);
    });
  });
}

/** `anc`'s spouse when that spouse is also a common ancestor reached from
 * both people through the very same family (the ancestor couple). */
function partnerInCommon(anc: string, a: AncestorMap, b: AncestorMap, common: Set<string>): string | null {
  const x1 = a.prev.get(anc);
  const x2 = b.prev.get(anc);
  if (!x1 || !x2) return null;
  const pa = a.partner.get(partnerKey(x1, anc));
  const pb = b.partner.get(partnerKey(x2, anc));
  if (!pa || pa !== pb || !common.has(pa)) return null;
  if (a.prev.get(pa) !== x1 || b.prev.get(pa) !== x2) return null;
  return pa;
}

/** [start, ..., anc] by following `prev`. */
function chainTo(map: AncestorMap, anc: string): string[] {
  const chain = [anc];
  for (let h = map.prev.get(anc); h; h = map.prev.get(h)) chain.push(h);
  return chain.reverse();
}

interface FoundPath {
  handles: string[];
  /** Gender of every person in `handles` and `commonAncestors`. */
  genders: Map<string, number>;
  commonAncestors: string[];
  /** Index in `handles` of commonAncestors[0]. */
  top: number;
}

/** The chains of people (handles only), nearest first. `depth` counts
 * generations the way Gramps' calculator and /relations/'s own `depth`
 * do: the person themselves plus depth - 1 generations of ancestors. */
export async function findRelationshipChains(
  handle1: string,
  handle2: string,
  deps: Pick<RelationshipPathDeps, "fetchPeople">,
  { depth = 15, maxPaths }: { depth?: number; maxPaths?: number } = {},
): Promise<FoundPath[]> {
  if (handle1 === handle2) return [{ handles: [handle1], genders: new Map(), commonAncestors: [], top: 0 }];
  const people = new Map<string, PathPerson>();
  const load = async (handles: string[]) => {
    const missing = [...new Set(handles)].filter((h) => !people.has(h));
    if (missing.length === 0) return;
    for (const p of await deps.fetchPeople(missing)) people.set(p.handle, p);
  };
  await load([handle1, handle2]);
  const p1 = people.get(handle1);
  const p2 = people.get(handle2);
  if (!p1 || !p2) return [];

  const found: FoundPath[] = [];
  // Everyone a path can name was loaded by the walk itself.
  const gendersOf = (handles: string[]) => new Map(handles.map((h) => [h, people.get(h)?.gender ?? 2]));
  // Gramps' own calculator reports a spouse before any blood relation.
  const shared = new Set(p1.family_list ?? []);
  if ((p2.family_list ?? []).some((f) => shared.has(f))) {
    found.push({ handles: [handle1, handle2], genders: gendersOf([handle1, handle2]), commonAncestors: [], top: 0 });
    if (maxPaths === 1) return found;
  }

  // Both walks advance one generation per round, so after round `gen` each
  // map is complete to that depth and any common ancestor not found yet is
  // at a total distance of at least gen + 1. One request per round covers
  // both sides (and an ancestor they share is only fetched once).
  const a = newAncestorMap(handle1);
  const b = newAncestorMap(handle2);
  let frontierA = [handle1];
  let frontierB = [handle2];
  for (let gen = 1; gen < depth && (frontierA.length || frontierB.length); gen++) {
    await load([...frontierA, ...frontierB]);
    frontierA = advance(a, frontierA, gen, people);
    frontierB = advance(b, frontierB, gen, people);
    if (maxPaths === 1) {
      // Only the nearest is wanted: stop once nothing still unseen could
      // beat (or tie with) it.
      let best = Infinity;
      for (const [h, d] of a.dist) if (b.dist.has(h)) best = Math.min(best, d + b.dist.get(h)!);
      if (best <= gen) break;
    }
  }

  const commonAll = [...a.dist.keys()].filter((h) => b.dist.has(h));
  if (commonAll.length === 0) return found;
  const commonSet = new Set(commonAll);
  const ancestors = (maxPaths === 1 ? commonAll : nearestCommonAncestors(commonAll, a, b)).sort((x, y) =>
    compareAncestors(a, b, x, y),
  );

  const covered = new Set<string>();
  for (const anc of ancestors) {
    if (maxPaths !== undefined && found.length >= maxPaths) break;
    if (covered.has(anc)) continue;
    covered.add(anc);
    const partner = partnerInCommon(anc, a, b, commonSet);
    if (partner) covered.add(partner);
    const up = chainTo(a, anc); // [handle1, ..., anc]
    const down = chainTo(b, anc).reverse().slice(1); // [..., handle2], below anc
    const commonAncestors = partner ? [anc, partner] : [anc];
    found.push({
      handles: [...up, ...down],
      genders: gendersOf([...up, ...down, ...commonAncestors]),
      commonAncestors,
      top: up.length - 1,
    });
  }
  return found;
}

/** The server's wording for `node` relative to `handle1`, picked from
 * /all's entries: the one going through `via` (this path's own common
 * ancestor -- `node` itself for someone on handle1's own line), so a
 * cousin who is also a spouse reads "first cousin" on the blood path and
 * "wife" on the spouse one. */
function pickLabel(entries: ServerRelationship[], via: string | null): string {
  const usable = entries.filter((e) => e.relationship_string);
  const match = via
    ? usable.find((e) => e.common_ancestors?.includes(via))
    : usable.find((e) => !e.common_ancestors?.length);
  return (match ?? usable[0])?.relationship_string ?? "";
}

/** Every path between two people, nearest first, each person labelled with
 * their relationship to `handle1` in Gramps' own words. `maxPaths: 1` is
 * much cheaper on a deep tree: the walk stops as soon as the nearest
 * common ancestor is certain.
 *
 * Only when there's no blood relationship and they aren't spouses (the
 * order Gramps itself goes in), in-law paths: through either person's
 * spouse, one marriage at most -- see RelationshipPath.via. Gramps'
 * calculator has no in-law answers of its own, so each label is still its
 * wording, just relative to that spouse. */
export async function getRelationshipPaths(
  handle1: string,
  handle2: string,
  deps: RelationshipPathDeps,
  options: { depth?: number; maxPaths?: number } = {},
): Promise<RelationshipPath[]> {
  const direct = await bloodPaths(handle1, handle2, deps, options);
  if (direct.length > 0 || !deps.fetchSpouses || handle1 === handle2) return direct;

  const [first, second] = await Promise.all([deps.fetchSpouses(handle1), deps.fetchSpouses(handle2)]);
  const spouseLabel = async (h1: string, h2: string) => pickLabel(await deps.fetchRelationships(h1, h2), null);
  const found: RelationshipPath[] = [];
  // handle1's spouse is related to handle2: [handle1, spouse, ...].
  for (const spouse of first.spouses) {
    for (const sub of await bloodPaths(spouse, handle2, deps, options)) {
      found.push({
        ...sub,
        people: [
          { handle: handle1, relationship_string: "", gender: first.gender },
          { ...sub.people[0], relationship_string: await spouseLabel(handle1, spouse) },
          ...sub.people.slice(1),
        ],
        via: { handle: spouse, married_to: handle1 },
      });
    }
  }
  // handle2's spouse is related to handle1: [handle1, ..., spouse, handle2].
  for (const spouse of second.spouses) {
    for (const sub of await bloodPaths(handle1, spouse, deps, options)) {
      found.push({
        ...sub,
        people: [...sub.people, { handle: handle2, relationship_string: await spouseLabel(spouse, handle2), gender: second.gender }],
        via: { handle: spouse, married_to: handle2 },
      });
    }
  }
  found.sort((x, y) => x.people.length - y.people.length);
  return options.maxPaths !== undefined ? found.slice(0, options.maxPaths) : found;
}

async function bloodPaths(
  handle1: string,
  handle2: string,
  deps: RelationshipPathDeps,
  options: { depth?: number; maxPaths?: number },
): Promise<RelationshipPath[]> {
  const chains = await findRelationshipChains(handle1, handle2, deps, options);
  const labelled = new Map<string, Promise<ServerRelationship[]>>();
  const entriesFor = (h: string) => {
    let p = labelled.get(h);
    if (!p) {
      p = deps.fetchRelationships(handle1, h);
      labelled.set(h, p);
    }
    return p;
  };
  return Promise.all(
    chains.map(async (chain) => {
      const gender = (h: string) => chain.genders.get(h) ?? 2;
      // An ancestor's own relationship goes through themselves -- which
      // covers the couple's other spouse too.
      const partnerHandle = chain.commonAncestors[1];
      return {
        via: null,
        common_ancestors: chain.commonAncestors,
        partner: partnerHandle
          ? {
              handle: partnerHandle,
              relationship_string: pickLabel(await entriesFor(partnerHandle), partnerHandle),
              gender: gender(partnerHandle),
            }
          : null,
        people: await Promise.all(
          chain.handles.map(async (h, i) => {
            if (i === 0) return { handle: h, relationship_string: "", gender: gender(h) };
            const via = chain.commonAncestors.length === 0 ? null : i <= chain.top ? h : chain.commonAncestors[0];
            return { handle: h, relationship_string: pickLabel(await entriesFor(h), via), gender: gender(h) };
          }),
        ),
      };
    }),
  );
}
