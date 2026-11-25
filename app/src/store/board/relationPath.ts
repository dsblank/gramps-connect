// "Pin the people in between" on the Evidence Board: the cards that show a
// relationship path on the cork. A path (relationshipPath.ts) lists only
// people; the board's yarn runs between a person and a Family card, so the
// family that joins each pair of neighbours is pinned too, in order, and the
// existing kin yarn then draws the chain.
import type { PathLink } from "../relationshipPath";
import type { GrampsClass, Records } from "./records";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const shared = (a: string[], b: string[]) => a.find((h) => b.includes(h));

/** The family joining `prev` and `next` (`next` is `link` of `prev`), from
 * their records; undefined when the records don't say (not loaded). */
export function familyBetween(prev: string, next: string, link: PathLink, records: Records): string | undefined {
  const p = records[prev];
  const n = records[next];
  if (!p || !n) return undefined;
  switch (link) {
    case "parent":
      return shared(list(p.parent_family_list), list(n.family_list));
    case "child":
      return shared(list(n.parent_family_list), list(p.family_list));
    case "sibling":
      return shared(list(p.parent_family_list), list(n.parent_family_list));
    case "spouse":
      return shared(list(p.family_list), list(n.family_list));
  }
}

/** Every card along a path, from its first person to its last, in order:
 * person, family, person, ... (a family appears once, even when it joins
 * three people, as at a sibling link through shared parents). */
export function pathCards(steps: { handle: string; link: PathLink | null }[], records: Records): { cls: GrampsClass; handle: string }[] {
  const out: { cls: GrampsClass; handle: string }[] = [];
  const seen = new Set<string>();
  const add = (cls: GrampsClass, handle: string | undefined) => {
    if (!handle || seen.has(handle)) return;
    seen.add(handle);
    out.push({ cls, handle });
  };
  steps.forEach((s, i) => {
    if (i > 0 && s.link) add("Family", familyBetween(steps[i - 1].handle, s.handle, s.link, records));
    add("Person", s.handle);
  });
  return out;
}
