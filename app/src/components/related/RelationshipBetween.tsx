// How two people are related, outside a Gramplet: the sentence ("Xena is
// Hal's first cousin once removed") and the same chart relationship_chart()
// draws: the full sentence, with Graph opening the Relationship window
// (above the selected person or people, SelectionDetailView.tsx), or with
// the chart below it (that window itself, and the Graphs view).
import { Anchor, Box, Group, Loader, Text } from "@mantine/core";
import { Fragment, type ReactNode } from "react";
import { t } from "../../i18n/i18n";
import { RelationshipChart, usePeople } from "../../pyodidePoc/RelationshipChart";
import type { RelationshipPath } from "../../store/relationshipPath";
import { useRelationshipPaths } from "../../store/relationshipPathsApi";
import { openRelationshipWindow } from "../../store/relationshipWindow";
import type { PersonMenuOptions } from "../../pyodidePoc/ObjectCellButton";

/** A translated pattern with {0}, {1}... replaced by text. */
const fill = (pattern: string, parts: string[]) => pattern.replace(/\{(\d+)\}/g, (_, i: string) => parts[Number(i)] ?? "");

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

/** The sentence's height when it's one line above a pane: always the
 * same, whatever it says or whether it's still searching, so nothing below
 * it moves. */
const LINE_H = 24;

/** The sentence for two people: `to` described in terms of `from` (for
 * two selected people, the one selected first). `chart="window"`: one
 * line of fixed height, cut short with the whole sentence on hover, and
 * Graph opening the Relationship window on the two -- for above a
 * pane, padded by the caller. `chart="always"`: the sentence wraps and the
 * chart is drawn below, filling the space. `delayMs` waits before
 * searching, so moving through a list only searches where it stops. With
 * `from` and `to` the same person -- the Home person selected -- it says
 * so, keeping the line in place. */
export function RelationshipBetween({
  from, to, revision, chart = "window", delayMs = 0, menu,
}: {
  from: string;
  to: string;
  revision: number;
  chart?: "window" | "always";
  delayMs?: number;
  /** Changes to the chart's person menus (ObjectMenu). */
  menu?: PersonMenuOptions;
}) {
  const state = useRelationshipPaths(from, to, { revision, delayMs });
  const people = usePeople([from, to]);
  const name = (h: string) => people.get(h)?.name || t("(unknown)");

  let sentence: ReactNode;
  let plain: string;
  let color: string | undefined = "dimmed";
  let loading = false;
  const paths = state.status === "done" ? state.paths : [];
  if (from === to) {
    plain = t("This is your Home person.");
    sentence = plain;
  } else if (state.status === "loading" || state.status === "idle") {
    loading = true;
    plain = t("Finding how they're related...");
    sentence = plain;
  } else if (state.status === "error") {
    color = "red";
    plain = state.message;
    sentence = plain;
  } else if (paths.length === 0) {
    const pattern = t("{0} and {1} aren't related within 15 links.");
    plain = fill(pattern, [name(to), name(from)]);
    sentence = plain;
  } else {
    color = undefined;
    const pattern = t("{0} is {1}'s {2}.");
    plain = fill(pattern, [name(to), name(from), labelOf(paths[0])]);
    sentence = fillNodes(pattern, [name(to), name(from), <b key="l">{labelOf(paths[0])}</b>]);
  }

  if (chart === "window") {
    return (
      <Group gap="xs" wrap="nowrap" h={LINE_H} style={{ flex: "none" }}>
        {loading && <Loader size="xs" style={{ flex: "none" }} />}
        <Text size="sm" c={color} truncate="end" title={plain} style={{ flex: 1, minWidth: 0 }}>
          {sentence}
        </Text>
        {paths.length > 0 && (
          <Anchor component="button" size="sm" style={{ flex: "none" }} onClick={() => openRelationshipWindow(from, to)}>
            {t("Graph")}
          </Anchor>
        )}
      </Group>
    );
  }
  return (
    <Box px="md" pt="xs" style={{ height: "100%", overflow: "auto" }}>
      <Group gap="xs" wrap="nowrap">
        {loading && <Loader size="xs" style={{ flex: "none" }} />}
        <Text size="sm" c={color} style={{ flex: 1, minWidth: 0 }}>
          {sentence}
        </Text>
      </Group>
      {paths.length > 0 && (
        <Box mt="xs">
          <RelationshipChart paths={paths} startLabel={name(from)} interactive menu={menu} />
        </Box>
      )}
    </Box>
  );
}
