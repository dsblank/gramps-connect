// The Graphs view's Relationship chart: two person boxes across the top
// and, below them, how they're related -- the same sentence and chart the
// two-person selection shows (RelationshipBetween.tsx), with the chart
// always open. The first box starts on the Home person, the second on the
// chart's root; picking in either only changes this chart, never the root.
import { ActionIcon, Box, Button, Group, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { useState } from "react";
import { t } from "../../i18n/i18n";
import type { PersonMenuOptions } from "../../pyodidePoc/ObjectCellButton";
import { usePeople } from "../../pyodidePoc/RelationshipChart";
import { getHomePersonHandle } from "../../store/homePersonPreference";
import { PERSON_VIEW } from "../../store/views";
import { RecordPicker } from "../RecordPicker";
import { pickerResultLabel } from "../RefPickerField";
import { RelationshipBetween } from "../related/RelationshipBetween";

export interface RelationshipPair {
  first: string | null;
  second: string | null;
  setFirst: (handle: string) => void;
  setSecond: (handle: string) => void;
  swap: () => void;
}

/** The two people compared. The first starts on the Home person and is kept
 * while the root changes; the second follows the root until another person
 * is picked for it, and goes back to the root when the root changes. Held
 * by TreeView, so switching chart styles keeps both. */
export function useRelationshipPair(rootHandle: string | null): RelationshipPair {
  const [first, setFirst] = useState<string | null>(() => getHomePersonHandle());
  const [secondPick, setSecondPick] = useState<{ root: string | null; handle: string | null } | null>(null);
  const second = secondPick && secondPick.root === rootHandle ? secondPick.handle : rootHandle;
  const setSecond = (handle: string | null) => setSecondPick({ root: rootHandle, handle });
  return {
    first,
    second,
    setFirst,
    setSecond,
    swap: () => {
      setFirst(second);
      setSecond(first);
    },
  };
}

/** A box showing one chosen person; clicking it opens a search to pick
 * another. */
function PersonBox({ handle, name, onPick }: { handle: string | null; name: string | undefined; onPick: (handle: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => setOpen(true)}
        style={{ flex: 1, minWidth: 0, maxWidth: 320 }}
        styles={{ label: { overflow: "hidden", textOverflow: "ellipsis" } }}
        c={handle ? undefined : "dimmed"}
        title={name}
      >
        {handle ? name ?? "…" : t("Pick a person")}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={t("Pick a person")}>
        <RecordPicker
          view={PERSON_VIEW}
          searchField="gramps_id"
          placeholder={PERSON_VIEW.simpleSearch?.placeholder ?? "Search…"}
          buildExpr={PERSON_VIEW.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel(PERSON_VIEW.key, item)}
          onPick={(item) => {
            setOpen(false);
            onPick(item.handle);
          }}
        />
      </Modal>
    </>
  );
}

export function RelationshipGraph({ pair }: { pair: RelationshipPair }) {
  const { first, second } = pair;
  const people = usePeople([first, second].filter((h): h is string => !!h));
  const name = (h: string | null) => (h ? people.get(h)?.name : undefined);
  const menu: PersonMenuOptions = {
    // Already in the Graphs view: "See as Tree" would only re-root it.
    hideVisuals: ["tree"],
    actions: (handle) => [
      ...(handle !== first ? [{ label: t("Use as first person"), onClick: () => pair.setFirst(handle) }] : []),
      ...(handle !== second ? [{ label: t("Use as second person"), onClick: () => pair.setSecond(handle) }] : []),
    ],
  };
  return (
    <Stack gap={0} style={{ flex: 1, minHeight: 0 }}>
      <Group gap="xs" wrap="nowrap" px="md" pt="xs">
        <PersonBox handle={first} name={name(first)} onPick={pair.setFirst} />
        <Tooltip label={t("Swap")}>
          <ActionIcon variant="subtle" aria-label={t("Swap")} disabled={!first || !second} onClick={pair.swap}>
            ⇄
          </ActionIcon>
        </Tooltip>
        <PersonBox handle={second} name={name(second)} onPick={pair.setSecond} />
      </Group>
      <Box style={{ flex: 1, minHeight: 0 }}>
        {first && second && first !== second ? (
          <RelationshipBetween from={first} to={second} revision={0} chart="always" menu={menu} />
        ) : (
          <Text size="sm" c="dimmed" px="md" pt="xs">
            {first && first === second
              ? t("Both boxes hold the same person. Pick someone else in one of them.")
              : !first && !second
                ? t("Pick two people to see how they're related.")
                : !first
                  ? t("No Home person is set. Pick a person in the first box.")
                  : t("Pick a person in the second box.")}
          </Text>
        )}
      </Box>
    </Stack>
  );
}
