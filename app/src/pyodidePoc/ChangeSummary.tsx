// What a run with "Allow data changes" changed (types.ts's ChangeGroup,
// built by changesBootstrap.ts) -- shown under the run's own output by
// GrampletResultView.tsx. Every run is a dry run for now, so this always
// says nothing was saved.
import { useState } from "react";
import { Alert, Button, Stack, Text } from "@mantine/core";
import { t } from "../i18n/i18n";
import type { ChangeGroup, RecordChange } from "./types";

/** Records listed before "Show all". */
const COLLAPSED_COUNT = 30;

function ChangeItem({ change }: { change: RecordChange }) {
  return (
    <div>
      <Text size="sm">
        <Text span fw={600} c={change.action === "delete" ? "red" : undefined}>
          {change.action === "delete" ? t("Delete") : t("Change")}
        </Text>{" "}
        {change.description}
      </Text>
      {change.action === "update" &&
        change.diffs.map((diff, i) => (
          <Text key={i} size="xs" c="dimmed" pl="md" style={{ wordBreak: "break-word" }}>
            {diff.path}: {diff.old || "—"} → {diff.new || "—"}
          </Text>
        ))}
      {change.action === "delete" && change.references > 0 && (
        <Text size="xs" c="orange" pl="md">
          {t("Still referred to by this many other records:")} {change.references}
        </Text>
      )}
    </div>
  );
}

export function ChangeSummary({ groups }: { groups: ChangeGroup[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = groups.reduce((sum, group) => sum + group.changes.length, 0);
  if (total === 0) return null;
  // Collapsing counts records across every group, in order.
  let budget = expanded ? Number.POSITIVE_INFINITY : COLLAPSED_COUNT;
  return (
    <Alert color="yellow" title={t("Dry run -- nothing was saved")}>
      <Stack gap="xs">
        <Text size="sm">
          {t("Records this run would change or delete:")} {total}
        </Text>
        {groups.map((group, i) => {
          const shown = group.changes.slice(0, Math.max(0, budget));
          budget -= shown.length;
          if (shown.length === 0) return null;
          return (
            <Stack key={i} gap={4}>
              {groups.length > 1 && (
                <Text size="sm" fw={600}>
                  {group.message}
                </Text>
              )}
              {shown.map((change) => (
                <ChangeItem key={`${change.objectType}:${change.handle}`} change={change} />
              ))}
            </Stack>
          );
        })}
        {total > COLLAPSED_COUNT && (
          <Button size="xs" variant="subtle" onClick={() => setExpanded((e) => !e)} style={{ alignSelf: "flex-start" }}>
            {expanded ? t("Show fewer") : t("Show all")}
          </Button>
        )}
      </Stack>
    </Alert>
  );
}
