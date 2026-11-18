// The chains of people connecting two people, from gramps-web-api's
// GET /relations/<h1>/<h2>/paths (3.26+): parent, child, sibling and
// spouse links, shortest first, each person labelled with their
// relationship to the first person in Gramps' own words. The server does
// the search (reading only the people near the two ends); this module
// tidies its answer up for the app:
//
// - Detours are dropped (see isDetourOf): the server links any two
//   children of one family as siblings, so "my brother" also comes back as
//   "my father's son" and "my mother's son".
// - Each step gets what a family-tree chart draws around it: the parents
//   above a sibling link, and the other parent beside a peak (an ancestor
//   both sides come down from through the same family).
// - Every person gets a `label`: Gramps' wording, or for someone it has no
//   word for (e.g. past a second marriage) one built from the person
//   before them, "brother-in-law's wife", with the caller's translated
//   pattern.
//
// Pure module with the network calls injected (RelationshipPathDeps), so
// it runs in the Gramplet worker (pyodideWorker.ts) and in tests alike.

export type PathLink = "parent" | "child" | "sibling" | "spouse";

/** One step of a /relations/<h1>/<h2>/paths path. */
export interface ServerPathStep {
  handle: string;
  /** How this person is linked to the one before them; null for the first. */
  link: PathLink | null;
  /** Relationship to the path's first person; null when Gramps has no name
   * for it. */
  relationship_string: string | null;
}

export interface ServerPath {
  steps: ServerPathStep[];
}

export interface PathFamily {
  handle?: string;
  father_handle?: string | null;
  mother_handle?: string | null;
}

/** The fields this module reads off GET /api/people/?handles=...
 * &extend=parent_family_list. */
export interface PathPerson {
  handle: string;
  gender?: number;
  parent_family_list?: string[];
  extended?: { parent_families?: PathFamily[] };
}

export interface PathSearchOptions {
  /** Most links in a path (the server allows at most MAX_PATH_DEPTH). */
  depth: number;
  /** Most paths to return. */
  max: number;
  /** Only paths up to a common ancestor and down again. */
  bloodOnly?: boolean;
}

export interface RelationshipPathDeps {
  fetchPaths(handle1: string, handle2: string, options: PathSearchOptions): Promise<ServerPath[]>;
  /** Every person named that exists; missing handles are just left out. */
  fetchPeople(handles: string[]): Promise<PathPerson[]>;
}

/** gramps-web-api's MAX_DEPTH for /paths. */
export const MAX_PATH_DEPTH = 15;
/** gramps-web-api's own cap on /paths' `max`. */
const SERVER_MAX_PATHS = 50;
/** English for an in-law label built from two: "brother-in-law's wife". */
export const DEFAULT_IN_LAW_PATTERN = "{0}'s {1}";

export interface PathNode {
  handle: string;
  /** Gramps' Person.gender: 0 female, 1 male, 2 unknown, 3 other. */
  gender: number;
  /** Relationship to the path's first person in Gramps' words; "" for the
   * first person, and where Gramps has none. */
  relationship_string: string;
  /** What to show: relationship_string, or one built from the person
   * before ("brother-in-law's wife"). "" for the first person. */
  label: string;
}

export interface PathStep extends PathNode {
  /** How this person is linked to the one before them; null for the first. */
  link: PathLink | null;
  /** With link "sibling": the parents the two have in common, drawn above
   * them (one or two; none for a family with no parents recorded). */
  parents?: PathNode[];
  /** At a peak (link "parent", next link "child"): the ancestor's spouse,
   * when both sides come down through the same family -- the ancestor
   * couple. */
  partner?: PathNode | null;
}

export interface RelationshipPath {
  /** From the first person to the second. */
  steps: PathStep[];
}

/** Whether `longer` is `shorter` with some of its links taken the long way
 * round, through one more person each: father -> brother for the sibling
 * link to that brother, or her mother -> his husband for the link to her
 * father. Every person of `shorter` is on it, in order, with at most one
 * other person between two neighbours. A longer path that merely shares
 * its ends (a cousin who is also a husband) isn't one. */
function isDetourOf(longer: string[], shorter: string[]): boolean {
  if (longer.length <= shorter.length) return false;
  let i = 0;
  for (let j = 0; j < shorter.length; j++) {
    const at = longer.indexOf(shorter[j], i);
    if (at < 0 || (j > 0 && at - i > 1) || (j === 0 && at !== 0)) return false;
    i = at + 1;
  }
  return i === longer.length;
}

/** Drops each path that is a shorter one's detour (see isDetourOf) --
 * including a detour of a detour, e.g. through grandfather -> his wife ->
 * her son for the sibling link to that son. Paths come shortest first. */
export function dropDetours(paths: ServerPath[]): ServerPath[] {
  const seen: string[][] = [];
  return paths.filter((path) => {
    const handles = path.steps.map((s) => s.handle);
    const detour = seen.some((shorter) => isDetourOf(handles, shorter));
    seen.push(handles);
    return !detour;
  });
}

/** The family both people are children of, if any. */
function sharedParentFamily(a: PathPerson | undefined, b: PathPerson | undefined): PathFamily | null {
  if (!a || !b) return null;
  const theirs = new Set(b.parent_family_list ?? []);
  return (a.extended?.parent_families ?? []).find((f) => f.handle && theirs.has(f.handle)) ?? null;
}

/** A parent family of `child` that `parent` is a parent in. */
function familyWithParent(child: PathPerson | undefined, parent: string): PathFamily | null {
  return (child?.extended?.parent_families ?? []).find((f) => f.father_handle === parent || f.mother_handle === parent) ?? null;
}

const parentsOf = (family: PathFamily | null): string[] =>
  family ? [family.father_handle, family.mother_handle].filter((h): h is string => !!h) : [];

/** The handles a step's extras (parents, partner) need, or none. */
function extrasFor(steps: ServerPathStep[], i: number, people: Map<string, PathPerson>): { parents?: string[]; partner?: string | null } {
  const step = steps[i];
  if (step.link === "sibling") {
    return { parents: parentsOf(sharedParentFamily(people.get(steps[i - 1].handle), people.get(step.handle))) };
  }
  if (step.link === "parent" && steps[i + 1]?.link === "child") {
    const left = familyWithParent(people.get(steps[i - 1].handle), step.handle);
    const right = familyWithParent(people.get(steps[i + 1].handle), step.handle);
    if (!left?.handle || left.handle !== right?.handle) return { partner: null };
    return { partner: parentsOf(left).find((h) => h !== step.handle) ?? null };
  }
  return {};
}

const fill = (pattern: string, anchor: string, word: string) => pattern.replace("{0}", anchor).replace("{1}", word);

/** Every path between two people, shortest first, each person labelled
 * with their relationship to `handle1`. `maxPaths` undefined means as
 * many as the server gives. `inLawPattern` builds a label from the person
 * before's ("{0}") and a one-link word ("{1}"), translated by the caller. */
export async function getRelationshipPaths(
  handle1: string,
  handle2: string,
  deps: RelationshipPathDeps,
  options: { depth?: number; maxPaths?: number; bloodOnly?: boolean; inLawPattern?: string } = {},
): Promise<RelationshipPath[]> {
  const depth = Math.max(1, Math.min(options.depth ?? MAX_PATH_DEPTH, MAX_PATH_DEPTH));
  const { maxPaths, bloodOnly = false, inLawPattern = DEFAULT_IN_LAW_PATTERN } = options;
  // Room for the detours dropped below: a sibling comes back two more
  // times, once through each parent.
  const max = maxPaths === undefined ? SERVER_MAX_PATHS : Math.min(SERVER_MAX_PATHS, maxPaths * 3 + 2);
  const found = await deps.fetchPaths(handle1, handle2, { depth, max, bloodOnly });
  const paths = dropDetours(found.filter((p) => p.steps.length > 0)).slice(0, maxPaths);
  if (paths.length === 0) return [];

  // Each person's label, from whichever path names them -- for a parent
  // above a sibling link, the detour through that parent usually did.
  const known = new Map<string, string>();
  for (const path of found)
    for (const step of path.steps)
      if (step.relationship_string && !known.has(step.handle)) known.set(step.handle, step.relationship_string);

  const people = new Map<string, PathPerson>();
  const load = async (handles: string[]) => {
    const missing = [...new Set(handles)].filter((h) => !people.has(h));
    if (missing.length > 0) for (const p of await deps.fetchPeople(missing)) people.set(p.handle, p);
  };
  await load(paths.flatMap((p) => p.steps.map((s) => s.handle)));
  const extras = paths.map((p) => p.steps.map((_, i) => (i === 0 ? {} : extrasFor(p.steps, i, people))));
  // Parents above sibling links and ancestor couples' spouses.
  await load(extras.flat().flatMap((e) => [...(e.parents ?? []), ...(e.partner ? [e.partner] : [])]));

  // Requests shared by every path: each is made at most once.
  const cache = new Map<string, Promise<string>>();
  const once = (key: string, request: () => Promise<ServerPath[]>, pick: (paths: ServerPath[]) => string | null | undefined) => {
    let value = cache.get(key);
    if (!value) {
      value = request()
        .then((r) => pick(r) ?? "")
        .catch(() => "");
      cache.set(key, value);
    }
    return value;
  };
  // Someone `from` is linked to directly: the server's one-link word for
  // them ("wife"), relative to `from`.
  const linkWord = (from: string, to: string) =>
    once(`link\n${from}\n${to}`, () => deps.fetchPaths(from, to, { depth: 1, max: 1 }), (r) => r[0]?.steps[1]?.relationship_string);
  // Someone off the path (a parent above a sibling link, an ancestor's
  // spouse): asked for directly, no further away than they stand here.
  const offPathLabel = (handle: string, distance: number) =>
    known.get(handle)
      ? Promise.resolve(known.get(handle)!)
      : once(
          `off\n${handle}`,
          () => deps.fetchPaths(handle1, handle, { depth: Math.max(1, Math.min(distance, MAX_PATH_DEPTH)), max: 1 }),
          (r) => {
            const steps = r[0]?.steps ?? [];
            return steps[steps.length - 1]?.relationship_string;
          },
        );

  /** A node for `handle`, with `name` (Gramps' wording) if any, else a
   * label built from `from`'s label and the one-link word. */
  const makeNode = async (handle: string, name: string, from: { handle: string; label: string } | null): Promise<PathNode> => {
    let label = name;
    if (!label && from) {
      const word = await linkWord(from.handle, handle);
      label = word && from.label ? fill(inLawPattern, from.label, word) : word;
    }
    return { handle, gender: people.get(handle)?.gender ?? 2, relationship_string: name, label };
  };

  return Promise.all(
    paths.map(async (path, p): Promise<RelationshipPath> => {
      const steps: PathStep[] = [];
      // In order: each label can build on the one before.
      for (const [i, s] of path.steps.entries()) {
        const node =
          i === 0
            ? { handle: s.handle, gender: people.get(s.handle)?.gender ?? 2, relationship_string: "", label: "" }
            : await makeNode(s.handle, s.relationship_string ?? "", steps[i - 1]);
        steps.push({ ...node, link: i === 0 ? null : s.link });
      }
      await Promise.all(
        steps.map(async (step, i) => {
          const extra = extras[p][i];
          // Off-path people hang off the person before this step: a
          // sibling's parents are that person's parents too, and a peak's
          // partner is the parent beside the one this side came up to.
          const below = steps[i - 1];
          const offPath = async (h: string) => makeNode(h, await offPathLabel(h, i), below);
          if (extra.parents) step.parents = await Promise.all(extra.parents.map(offPath));
          if (extra.partner !== undefined) step.partner = extra.partner ? await offPath(extra.partner) : null;
        }),
      );
      return { steps };
    }),
  );
}
