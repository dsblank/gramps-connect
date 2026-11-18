// How two people are related, outside a Gramplet: the sentence ("Xena is
// Hal's first cousin once removed") and the same chart relationship_chart()
// draws. Two forms:
// - RelationshipBetween: the full sentence, with Show chart opening the
//   Relationship window (two selected people, SelectionDetailView.tsx), or
//   with the chart below it (that window itself, and the Graphs view).
// - HomeRelationshipLine: one short line under a person's name ("Home
//   person's first cousin") that opens the window (RelatedPanel.tsx).
import { Anchor, Box, Group, Loader, Text } from "@mantine/core";
import { Fragment, type ReactNode } from "react";
import { t } from "../../i18n/i18n";
import { RelationshipChart, usePeople } from "../../pyodidePoc/RelationshipChart";
import { getHomePersonHandle } from "../../store/homePersonPreference";
import type { RelationshipPath } from "../../store/relationshipPath";
import { useRelationshipPaths } from "../../store/relationshipPathsApi";
import { openRelationshipWindow } from "../../store/relationshipWindow";

/** A translated pattern with {0}, {1}... replaced by nodes. */
function fillNodes(pattern: string, parts: ReactNode[]): ReactNode {
  return pattern.split(/(\{\d+\})/).map((piece, i) => {
    const m = /^\{(\d+)\}$/.exec(piece);
    return <Fragment key={i}>{m ? parts[Number(m[1])] : piece}</Fragment>;
  });
}

const labelOf = (path: RelationshipPath) => {
  const end = path.steps[path.steps.length - 1];
  return end.label || end.relationship_string;
};

/** The sentence for two people: `to` described in terms of `from` (for
 * two selected people, the one selected first). `chart="window"` adds Show
 * chart, opening the Relationship window on the two; `chart="always"`
 * draws the chart below and lets it fill the space. */
export function RelationshipBetween({
  from, to, revision, chart = "window",
}: {
  from: string;
  to: string;
  revision: number;
  chart?: "window" | "always";
}) {
  const state = useRelationshipPaths(from, to, { revision });
  const people = usePeople([from, to]);
  const name = (h: string) => people.get(h)?.name || t("(unknown)");

  let body: ReactNode;
  if (state.status === "loading" || state.status === "idle") {
    body = (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          {t("Finding how they're related...")}
        </Text>
      </Group>
    );
  } else if (state.status === "error") {
    body = (
      <Text size="sm" c="red">
        {state.message}
      </Text>
    );
  } else if (state.paths.length === 0) {
    body = (
      <Text size="sm" c="dimmed">
        {fillNodes(t("{0} and {1} aren't related within 15 links."), [name(to), name(from)])}
      </Text>
    );
  } else {
    body = (
      <>
        <Group gap="xs" wrap="wrap">
          <Text size="sm">{fillNodes(t("{0} is {1}'s {2}."), [name(to), name(from), <b key="l">{labelOf(state.paths[0])}</b>])}</Text>
          {chart === "window" && (
            <Anchor component="button" size="sm" onClick={() => openRelationshipWindow(from, to)}>
              {t("Show chart")}
            </Anchor>
          )}
        </Group>
        {chart === "always" && (
          <Box mt="xs">
            <RelationshipChart paths={state.paths} startLabel={name(from)} interactive />
          </Box>
        )}
      </>
    );
  }
  return (
    <Box px="md" pt="xs" style={chart === "always" ? { height: "100%", overflow: "auto" } : { flex: "none" }}>
      {body}
    </Box>
  );
}

/** One line under a person's name: how they're related to the Home
 * person; clicking it opens the Relationship window on the two. Nothing
 * for the Home person themselves, with no Home person set, or for someone
 * not related. */
export function HomeRelationshipLine({ handle, revision }: { handle: string; revision: number }) {
  const home = getHomePersonHandle();
  // A short wait: moving through a list only searches for where it stops.
  const state = useRelationshipPaths(home, handle, { revision, delayMs: 300 });
  if (!home || state.status !== "done" || state.paths.length === 0) return null;
  return (
    <Anchor component="button" size="sm" c="dimmed" onClick={() => openRelationshipWindow(home, handle)} title={t("Show how they're related")}>
      {fillNodes(t("Home person's {0}"), [labelOf(state.paths[0])])}
    </Anchor>
  );
}
