// How two people are related, outside a Gramplet: the sentence ("Xena is
// Hal's first cousin once removed") and, on request, the same chart
// relationship_chart() draws. Two forms:
// - RelationshipBetween: the full sentence and a Show chart toggle, for
//   two selected people (SelectionDetailView.tsx).
// - HomeRelationshipLine: one short line under a person's name ("Home
//   person's first cousin"), the chart in a dialog (RelatedPanel.tsx).
import { Anchor, Box, Group, Loader, Modal, Text } from "@mantine/core";
import { Fragment, useState, type ReactNode } from "react";
import { t } from "../../i18n/i18n";
import { RelationshipChart, usePeople } from "../../pyodidePoc/RelationshipChart";
import { getHomePersonHandle } from "../../store/homePersonPreference";
import type { RelationshipPath } from "../../store/relationshipPath";
import { useRelationshipPaths } from "../../store/relationshipPathsApi";

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

/** The sentence for two selected people: `to` described in terms of
 * `from`, the one selected first. */
export function RelationshipBetween({ from, to, revision }: { from: string; to: string; revision: number }) {
  const state = useRelationshipPaths(from, to, { revision });
  const people = usePeople([from, to]);
  const [showChart, setShowChart] = useState(false);
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
          <Anchor component="button" size="sm" onClick={() => setShowChart((v) => !v)}>
            {showChart ? t("Hide chart") : t("Show chart")}
          </Anchor>
        </Group>
        {showChart && (
          <Box mt="xs">
            <RelationshipChart paths={state.paths} startLabel={name(from)} interactive />
          </Box>
        )}
      </>
    );
  }
  return (
    <Box px="md" pt="xs" style={{ flex: "none", maxHeight: "50%", overflow: "auto" }}>
      {body}
    </Box>
  );
}

/** One line under a person's name: how they're related to the Home
 * person, with the chart a click away. Nothing for the Home person
 * themselves, with no Home person set, or for someone not related. */
export function HomeRelationshipLine({ handle, revision }: { handle: string; revision: number }) {
  const home = getHomePersonHandle();
  // A short wait: moving through a list only searches for where it stops.
  const state = useRelationshipPaths(home, handle, { revision, delayMs: 300 });
  const [open, setOpen] = useState(false);
  if (!home || state.status !== "done" || state.paths.length === 0) return null;
  return (
    <>
      <Anchor component="button" size="sm" c="dimmed" onClick={() => setOpen(true)} title={t("Show how they're related")}>
        {fillNodes(t("Home person's {0}"), [labelOf(state.paths[0])])}
      </Anchor>
      <Modal opened={open} onClose={() => setOpen(false)} title={t("Relationship to Home person")} size="auto">
        <RelationshipChart paths={state.paths} startLabel={null} interactive />
      </Modal>
    </>
  );
}
