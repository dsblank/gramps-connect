// The Graphs view's Relationship chart: how the chart's root person is
// related to someone else -- the Home person unless another is picked --
// as the same sentence and chart the two-person selection shows
// (RelationshipBetween.tsx), with the chart always open.
import { Group, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { t } from "../../i18n/i18n";
import { getHomePersonHandle } from "../../store/homePersonPreference";
import { PERSON_VIEW } from "../../store/views";
import { RecordPicker } from "../RecordPicker";
import { pickerResultLabel } from "../RefPickerField";
import { RelationshipBetween } from "../related/RelationshipBetween";

function PersonPicker({ onPick }: { onPick: (handle: string) => void }) {
  return (
    <RecordPicker
      view={PERSON_VIEW}
      searchField="gramps_id"
      placeholder={PERSON_VIEW.simpleSearch?.placeholder ?? "Search…"}
      buildExpr={PERSON_VIEW.simpleSearch?.buildExpr}
      renderLabel={(item) => pickerResultLabel(PERSON_VIEW.key, item)}
      onPick={(item) => onPick(item.handle)}
    />
  );
}

/** The person to compare with, starting at the Home person. Kept while the
 * root changes, so re-rooting compares the new root with the same person. */
export function useRelationshipOther(): [string | null, (handle: string) => void] {
  const [other, setOther] = useState<string | null>(() => getHomePersonHandle());
  return [other, setOther];
}

/** The status-bar control: who the root is compared with. */
export function RelationshipOtherPicker({ onPick }: { onPick: (handle: string) => void }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        {t("Compare with:")}
      </Text>
      <PersonPicker onPick={onPick} />
    </Group>
  );
}

export function RelationshipGraph({ rootHandle, other, onPickOther }: { rootHandle: string; other: string | null; onPickOther: (handle: string) => void }) {
  if (!other || other === rootHandle) {
    return (
      <Stack align="center" justify="center" gap="xs" h="100%" maw={360} mx="auto">
        <Text size="sm" fw={600}>
          {t("Pick a person to compare with")}
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          {other === rootHandle
            ? t("The chart is already on this person. Pick someone else to compare with.")
            : t("No Home person is set. Pick someone to see how they're related.")}
        </Text>
        <PersonPicker onPick={onPickOther} />
      </Stack>
    );
  }
  return <RelationshipBetween from={other} to={rootHandle} revision={0} chart="always" />;
}
