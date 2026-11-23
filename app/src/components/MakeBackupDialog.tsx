import { Button, Code, Group, Modal, Stack, Text } from "@mantine/core";
import { hasPermissions } from "../auth/auth";
import { t } from "../i18n/i18n";
import { startBackupExport, startMediaExport } from "../store/startExport";
import { downloadLocalSettings } from "../store/downloadLocalSettings";

interface MakeBackupDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Family Trees -> Make Backup…: the counterpart to Restore from Backup.
 * The backup itself is a Gramps XML export of everything (private records
 * and living people included), the one file Restore reads. What that file
 * leaves out is listed here, with a button for each part that can be
 * downloaded, so nobody mistakes the .gramps file for the whole picture. */
export function MakeBackupDialog({ opened, onClose }: MakeBackupDialogProps) {
  function backUpTree() {
    onClose();
    startBackupExport();
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("Make Backup")} size="lg">
      <Stack gap="md">
        <Text size="sm">
          {t("Saves the whole family tree, including private records and living people, as a Gramps XML (.gramps) file. Restore from Backup reads this file, and desktop Gramps can import it.")}
        </Text>
        {!hasPermissions("ViewPrivate") && (
          <Text size="sm" c="orange">
            {t("You do not have permission to view private records, so the backup will be incomplete.")}
          </Text>
        )}
        <Text size="sm" c="dimmed">
          {hasPermissions("AddObject")
            ? t("The finished file appears in Output, where you can download it.")
            : t("The finished file downloads to your computer when it's ready.")}
        </Text>

        <Stack gap={6}>
          <Text size="sm" fw={500}>{t("Not in the tree file")}</Text>

          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Text size="sm">
              {t("Media files: photos and documents, and the contents of Saved Filters, Custom Rules, Gramplets and map overlays.")}
            </Text>
            <Button variant="default" size="xs" onClick={startMediaExport} style={{ flexShrink: 0 }}>
              {t("Download media")}
            </Button>
          </Group>

          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Text size="sm">
              {t("Settings in this browser: layout, column widths, window positions, search sites and drafts.")}
            </Text>
            <Button variant="default" size="xs" onClick={downloadLocalSettings} style={{ flexShrink: 0 }}>
              {t("Download settings")}
            </Button>
          </Group>

          <Text size="sm">
            {t("The tree's Preferences (date and place formats, citation templates) and user accounts are kept on the server, not in any download.")}
          </Text>
        </Stack>

        <Text size="xs" c="dimmed">
          {t("On Gramps Connect Desktop, copying this folder while the app is closed also keeps the media, the Preferences and the user accounts:")}{" "}
          <Code>~/.gramps-connect-desktop</Code>
        </Text>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={backUpTree}>{t("Back Up Tree")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
