import { Progress, Stack, Text } from "@mantine/core";
import { t } from "../../i18n/i18n";
import type { BulkEditProgress } from "../../store/bulkEdit";

/** "Working…" with a moving bar, then "1,500 of 4,900" once a background
 * task reports how far it is -- a small edit finishes before anything
 * shows. Shared by BulkTagButton and BulkPrivacyButton. */
export function BulkEditProgressBar({ progress }: { progress: BulkEditProgress | null }) {
  const done = progress?.done ?? null;
  const total = progress?.total ?? 0;
  return (
    <Stack gap={4}>
      <Progress value={done === null || total === 0 ? 100 : (100 * done) / total} animated={done === null} />
      <Text size="xs" c="dimmed">
        {done === null
          ? t("Working…")
          : t("%s of %s").replace("%s", done.toLocaleString()).replace("%s", total.toLocaleString())}
      </Text>
    </Stack>
  );
}

/** "Tagged 1,200 objects." -- with how many were already that way when
 * the server says how many changed. */
export function bulkEditSummary(doneMessage: string, changed: number | null, total: number): string {
  const count = (changed ?? total).toLocaleString();
  const message = doneMessage.replace("%s", count);
  if (changed === null || changed === total) return message;
  return `${message} ${t("%s already were.").replace("%s", (total - changed).toLocaleString())}`;
}
