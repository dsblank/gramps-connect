// The chains of people connecting two people, from gramps-web-api's
// GET /relations/<h1>/<h2>/paths (3.26+): parent, child, sibling and
// spouse links, shortest first, each person labelled with their
// relationship to the first person in Gramps' own words. The server does
// the search (reading only the people near the two ends), so this module
// only tidies its answer up for the app:
//
// - Near-duplicates are dropped. The server links any two children of one
//   family as siblings, so "my brother" also comes back as "my father's
//   son" and "my mother's son"; a path through everyone a shorter one goes
//   through is the same connection with a detour.
// - Each path also gets the shape RelationshipChart.tsx draws (`people`,
//   `common_ancestors`, `partner`, `via`): up to a common ancestor (or
//   ancestor couple) and down, with at most one marriage at each end. A
//   sibling link becomes the pair's parents, as a family tree shows them.
// - The server has no name for some people, e.g. past a second marriage.
//   They get a one-link label from the person before them instead
//   (`link_label`, e.g. "wife", from `link_from`), which the chart turns
//   into "brother-in-law's wife" in the user's language.
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

export interface PathNode {
  handle: string;
  /** This person's relationship to the path's first person ("" for that
   * person themselves, and when Gramps has no name for it). */
  relationship_string: string;
  /** Gramps' Person.gender: 0 female, 1 male, 2 unknown, 3 other. */
  gender: number;
  /** Only when relationship_string is "": this person's relationship to
   * `link_from` ("wife"), to be read after that person's own label --
   * "brother-in-law's wife". */
  link_label?: string;
  link_from?: string;
}

export interface PathStep extends PathNode {
  /** How this person is linked to the one before them; null for the first. */
  link: PathLink | null;
}

export interface RelationshipPath {
  /** The chain as found, from the first person to the second. */
  steps: PathStep[];
  /** The chart's version of it: from the first person to the second, up
   * through common_ancestors[0] and back down, plus whoever married in at
   * either end (see `via`). A path that doesn't have that shape (e.g. two
   * marriage in the middle) is just the steps, with no common_ancestors. */
  people: PathNode[];
  /** The ancestor the path goes through, then their spouse when both are
   * common ancestors through the same family. Empty for spouses, and for
   * a path the chart can't draw as one family tree. */
  common_ancestors: string[];
  /** That spouse (common_ancestors[1]), labelled like the people on the
   * path -- they aren't one of them, but a chart draws them beside
   * common_ancestors[0]. Null when there's a single common ancestor. */
  partner: PathNode | null;
  /** For an in-law path, the marriages it goes through, in path order --
   * at most one at each end. Empty for every other path. */
  via: InLawMarriage[];
}

/** What relationship_chart() draws: a path from getRelationshipPaths(),
 * or one a Gramplet built by hand, which may leave out `steps`. */
export type ChartPath = Omit<RelationshipPath, "steps"> & { steps?: PathStep[] };

/** One marriage an in-law path goes through: `handle` is the one on the
 * blood-relationship side, `married_to` the end of the path married to
 * them (the first person's spouse, or the last person's). */
export interface InLawMarriage {
  handle: string;
  married_to: string;
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

/** The family both people are children of, if any -- one with at least one
 * parent, so it has someone to draw on top. */
function sharedParentFamily(a: PathPerson | undefined, b: PathPerson | undefined): PathFamily | null {
  if (!a || !b) return null;
  const theirs = new Set(b.parent_family_list ?? []);
  return (
    (a.extended?.parent_families ?? []).find(
      (f) => f.handle && theirs.has(f.handle) && (f.father_handle || f.mother_handle),
    ) ?? null
  );
}

/** A parent family of `child` that `parent` is a parent in. */
function familyWithParent(child: PathPerson | undefined, parent: string): PathFamily | null {
  return (child?.extended?.parent_families ?? []).find((f) => f.father_handle === parent || f.mother_handle === parent) ?? null;
}

const otherParent = (family: PathFamily | null, parent: string): string | null => {
  if (!family) return null;
  const other = family.father_handle === parent ? family.mother_handle : family.father_handle;
  return other && other !== parent ? other : null;
};

/** What the chart needs, in handles: the blood part (with a sibling link
 * replaced by the pair's parent), the common ancestors, and the marriages
 * at the ends. Null for a path that isn't one family tree's worth: a
 * marriage in the middle, or going up again after coming down. */
interface ChartShape {
  people: string[];
  commonAncestors: string[];
  via: InLawMarriage[];
}

function chartShape(steps: ServerPathStep[], people: Map<string, PathPerson>): ChartShape | null {
  const n = steps.length;
  const handles = steps.map((s) => s.handle);
  if (n <= 2 && (n === 1 || steps[1].link === "spouse")) {
    // A lone person, or a spouse: drawn side by side.
    return { people: handles, commonAncestors: [], via: [] };
  }
  let lo = 0;
  let hi = n - 1;
  const via: InLawMarriage[] = [];
  if (steps[1].link === "spouse") {
    via.push({ handle: handles[1], married_to: handles[0] });
    lo = 1;
  }
  if (steps[n - 1].link === "spouse") {
    via.push({ handle: handles[n - 2], married_to: handles[n - 1] });
    hi = n - 2;
  }
  // A spouse's spouse isn't an in-law.
  if (hi <= lo) return null;

  const blood = handles.slice(lo, hi + 1);
  const links = steps.slice(lo + 1, hi + 1).map((s) => s.link);
  // Up, at most one step across, then down.
  let phase = 0;
  for (const link of links) {
    const next = link === "parent" ? 0 : link === "sibling" ? 1 : link === "child" ? 2 : 3;
    if (next < phase || next === 3) return null;
    phase = next === 1 ? 2 : next;
  }

  const sibling = links.indexOf("sibling");
  let top: number;
  let ancestor: string;
  let partner: string | null = null;
  if (sibling >= 0) {
    // blood[sibling] and blood[sibling + 1] are siblings: put a parent of
    // theirs (and the other one, as the couple) between them.
    const family = sharedParentFamily(people.get(blood[sibling]), people.get(blood[sibling + 1]));
    if (!family) return null;
    ancestor = (family.father_handle || family.mother_handle)!;
    partner = otherParent(family, ancestor);
    blood.splice(sibling + 1, 0, ancestor);
    top = sibling + 1;
  } else {
    top = links.lastIndexOf("parent") + 1;
    ancestor = blood[top];
    if (top > 0 && top < blood.length - 1) {
      // The ancestor's spouse is a common ancestor too when both people
      // come down through the same family.
      const left = familyWithParent(people.get(blood[top - 1]), ancestor);
      const right = familyWithParent(people.get(blood[top + 1]), ancestor);
      if (left?.handle && left.handle === right?.handle) partner = otherParent(left, ancestor);
    }
  }
  return {
    people: [...handles.slice(0, lo), ...blood, ...handles.slice(hi + 1)],
    commonAncestors: partner ? [ancestor, partner] : [ancestor],
    via,
  };
}

/** Every path between two people, shortest first, each person labelled
 * with their relationship to `handle1`. `maxPaths` undefined means as
 * many as the server gives. */
export async function getRelationshipPaths(
  handle1: string,
  handle2: string,
  deps: RelationshipPathDeps,
  options: { depth?: number; maxPaths?: number; bloodOnly?: boolean } = {},
): Promise<RelationshipPath[]> {
  const depth = Math.max(1, Math.min(options.depth ?? MAX_PATH_DEPTH, MAX_PATH_DEPTH));
  const { maxPaths, bloodOnly = false } = options;
  // Room for the detours dropped below: a sibling comes back two more
  // times, once through each parent.
  const max = maxPaths === undefined ? SERVER_MAX_PATHS : Math.min(SERVER_MAX_PATHS, maxPaths * 3 + 2);
  const found = await deps.fetchPaths(handle1, handle2, { depth, max, bloodOnly });
  const paths = dropDetours(found.filter((p) => p.steps.length > 0)).slice(0, maxPaths);
  if (paths.length === 0) return [];

  // Each person's label, from whichever path names them -- for a parent
  // put in for a sibling link, the detour through that parent did.
  const labels = new Map<string, string>();
  for (const path of found)
    for (const step of path.steps)
      if (step.relationship_string && !labels.has(step.handle)) labels.set(step.handle, step.relationship_string);

  const people = new Map<string, PathPerson>();
  const load = async (handles: string[]) => {
    const missing = [...new Set(handles)].filter((h) => !people.has(h));
    if (missing.length > 0) for (const p of await deps.fetchPeople(missing)) people.set(p.handle, p);
  };
  await load(paths.flatMap((p) => p.steps.map((s) => s.handle)));
  const shapes = paths.map((p) => chartShape(p.steps, people));
  // Parents put in for a sibling link, and ancestor couples' spouses.
  await load(shapes.flatMap((s) => (s ? [...s.people, ...s.commonAncestors] : [])));

  // An ancestor put in for a sibling link that no path the server gave
  // names: ask for a path to them, no longer than where they stand on this
  // one -- normally the same way up.
  const ancestorLabels = new Map<string, Promise<string | null>>();
  const ancestorLabel = (handle: string, distance: number) => {
    const known = labels.get(handle);
    if (known) return Promise.resolve(known);
    let label = ancestorLabels.get(handle);
    if (!label) {
      label = deps
        .fetchPaths(handle1, handle, { depth: Math.max(1, Math.min(distance, MAX_PATH_DEPTH)), max: 1 })
        .then((r) => {
          const steps = r[0]?.steps ?? [];
          return steps[steps.length - 1]?.relationship_string ?? null;
        })
        .catch(() => null);
      ancestorLabels.set(handle, label);
    }
    return label;
  };

  // One-link labels for anyone the server couldn't name, one request per
  // distinct pair -- a depth-1 search, so cheap.
  const linkLabels = new Map<string, Promise<string>>();
  const linkLabel = (from: string, to: string) => {
    const key = `${from}\n${to}`;
    let label = linkLabels.get(key);
    if (!label) {
      label = deps
        .fetchPaths(from, to, { depth: 1, max: 1 })
        .then((r) => r[0]?.steps[1]?.relationship_string ?? "")
        .catch(() => "");
      linkLabels.set(key, label);
    }
    return label;
  };
  const makeNode = async (handle: string, label: string | null | undefined, from: string | null): Promise<PathNode> => {
    const node: PathNode = { handle, relationship_string: label ?? "", gender: people.get(handle)?.gender ?? 2 };
    if (!node.relationship_string && from) {
      const word = await linkLabel(from, handle);
      if (word) Object.assign(node, { link_label: word, link_from: from });
    }
    return node;
  };

  return Promise.all(
    paths.map(async (path, i): Promise<RelationshipPath> => {
      const steps = await Promise.all(
        path.steps.map(async (s, j) => ({
          ...(await makeNode(s.handle, j === 0 ? "" : s.relationship_string, j === 0 ? null : path.steps[j - 1].handle)),
          link: j === 0 ? null : s.link,
        })),
      );
      const shape = shapes[i];
      if (!shape) {
        return { steps, people: steps.map(({ link: _, ...node }) => node), common_ancestors: [], partner: null, via: [] };
      }
      const byHandle = new Map(steps.map(({ link: _, ...node }) => [node.handle, node]));
      const chartPeople = await Promise.all(
        shape.people.map(
          async (h, j) => byHandle.get(h) ?? makeNode(h, await ancestorLabel(h, j), j > 0 ? shape.people[j - 1] : null),
        ),
      );
      const [ancestor, partnerHandle] = shape.commonAncestors;
      // The partner is labelled from the person below the couple, as the
      // ancestor beside them would be.
      const below = shape.people[shape.people.indexOf(ancestor) - 1] ?? shape.people[shape.people.indexOf(ancestor) + 1];
      const partner = partnerHandle
        ? await makeNode(partnerHandle, await ancestorLabel(partnerHandle, shape.people.indexOf(ancestor)), below ?? null)
        : null;
      return { steps, people: chartPeople, common_ancestors: shape.commonAncestors, partner, via: shape.via };
    }),
  );
}
