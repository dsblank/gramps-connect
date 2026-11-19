// The toast grampletStoreNews.ts's daily check shows when it finds new
// Gramplets in the Store, or updates to installed ones. Same shape as
// appUpdateCheck.tsx's: stays until closed, with one button.
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { t } from "../i18n/i18n";
import { requestOpenGrampletStore, type NewsCounts } from "./grampletStoreNews";

const NOTIFICATION_ID = "gramplet-store-news";

export function grampletStoreNewsMessage({ newCount, updateCount }: NewsCounts): string {
  const parts: string[] = [];
  if (newCount === 1) parts.push(t("1 new Gramplet"));
  else if (newCount > 1) parts.push(t("{count} new Gramplets").replace("{count}", String(newCount)));
  if (updateCount === 1) parts.push(t("1 update to an installed Gramplet"));
  else if (updateCount > 1) {
    parts.push(t("{count} updates to installed Gramplets").replace("{count}", String(updateCount)));
  }
  return t("The Gramplet Store has {news}.").replace("{news}", parts.join(t(" and ")));
}

export function showGrampletStoreNewsToast(counts: NewsCounts): void {
  notifications.show({
    id: NOTIFICATION_ID,
    color: "blue",
    title: t("Gramplet Store"),
    autoClose: false,
    withCloseButton: true,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">{grampletStoreNewsMessage(counts)}</Text>
        <Button
          size="xs"
          onClick={() => {
            notifications.hide(NOTIFICATION_ID);
            requestOpenGrampletStore();
          }}
        >
          {t("Open")}
        </Button>
      </Group>
    ),
  });
}
