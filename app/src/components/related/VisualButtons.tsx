import { Button, Group, Tooltip } from "@mantine/core";
import { formatHash, isSubjectKey, VISUAL_KEYS, type VisualKey } from "../../hash";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";

/** What each button promises for the type it's shown on. The wording is
 * deliberately different per type: for a person or a family the visual
 * narrows to their records, for an event or a place it puts that record in
 * context -- which is what the visuals themselves do by default (see each
 * view's mode seeding). Saying "Show on map" everywhere would promise a
 * filter that two of the four types don't get.
 *
 * A type's entry may omit a key (event/place omit `tree` below) -- Tree has
 * no "put this record in context" meaning for a single event or place, only
 * for a person/family it can root a chart on, so it's the presence of a
 * hint, not a separate applicability list, that decides whether a visual's
 * button shows on a given type (see the render loop's `hints[visual]`
 * filter). */
const HINTS: Record<string, Partial<Record<VisualKey, string>>> = {
  person: {
    map: "Map the places this person's events happened",
    timeline: "Put this person's events on the timeline",
    tree: "See this person's ancestors and descendants as a tree",
  },
  family: {
    map: "Map the places this couple's events happened",
    timeline: "Put this couple's events on the timeline",
    tree: "See this family's tree, rooted on a parent",
  },
  event: {
    map: "Find where this event happened on the map",
    timeline: "Find this event on the timeline",
  },
  place: {
    map: "Find this place on the map",
    timeline: "Put everything that happened here on the timeline",
  },
};

// `search` has no HINTS entry on any type (see above) so its button never
// actually renders -- this is only here to keep the Record exhaustive.
const LABELS: Record<VisualKey, string> = { map: "Map", timeline: "Timeline", tree: "Graphs", search: "Search all" };

/** Map/Timeline/Tree buttons on their own row directly beneath a
 * RelatedPanel's title, for the four types a visual can be scoped to
 * (hash.ts's SUBJECT_KEYS) -- Tree only on person/family, via its HINTS
 * entry (event/place have no hint for it, so the render loop skips it).
 *
 * Below the title rather than in the header's action slot because these
 * aren't actions on the record -- they don't change it, they're more ways
 * of looking at it, and they're the only ones this panel offers. The header
 * slot is for Edit/Delete/Message, which do act on it.
 *
 * Each is a plain link to the visual's own route carrying this record as
 * its subject -- there's no state to hand over, because the scope lives in
 * the URL: Map/Timeline re-derive their handles from the local caches when
 * they get there (store/visualScope.ts), Tree re-derives a root person the
 * same local way (store/treeData.ts's resolveTreeRoot) and then fetches the
 * tree itself over the network. Anchors rather than buttons so middle-click,
 * copy-link and Back all behave the way the rest of this app's navigation
 * does.
 *
 * Shown unconditionally on the types they apply to, including where the
 * record turns out to have nothing to plot (Map/Timeline) or no resolvable
 * root (Tree, on a parentless family). Predicting that would mean resolving
 * the scope here, in every panel, for a button most users won't press --
 * and the visual already says so clearly when it happens ("nothing to plot
 * for this record"), which is a better place to learn it than a button that
 * silently isn't there. */
export function VisualButtons({ view, detail }: { view: ViewConfig; detail: ObjectDetail }) {
  if (!isSubjectKey(view.key)) return null;
  const hints = HINTS[view.key];
  return (
    <Group gap="xs" wrap="wrap">
      {VISUAL_KEYS.filter((visual) => hints[visual]).map((visual) => (
        <Tooltip key={visual} label={hints[visual]} withArrow>
          <Button
            component="a"
            href={formatHash({ viewKey: visual, subject: { type: view.key, handle: detail.handle } })}
            size="xs"
            // Tinted rather than the header icons' bare treatment -- these
            // sit in the body's own reading order, where an outline button
            // reads as disabled next to real text.
            variant="light"
          >
            {LABELS[visual]}
          </Button>
        </Tooltip>
      ))}
    </Group>
  );
}
