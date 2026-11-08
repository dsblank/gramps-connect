// Preferences > General's "Settings in this browser": download them as a
// JSON file, load (merge) one back, or reset them. See store/localSettings.ts
// for what's covered. Load and Reset reload the page, since most settings
// are only read at startup; sign-in is in sessionStorage, so it survives.
import { useState } from "react";
import { Alert, Button, FileButton, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { t } from "../i18n/i18n";
import { clickDownloadLink } from "../store/downloadFile";
import {
  exportLocalSettings,
  importLocalSettings,
  parseSettingsFile,
  resetLocalSettings,
  SettingsFileInvalid,
  settingsFileName,
  type SettingsFileError,
} from "../store/localSettings";

const FILE_ERRORS: Record<SettingsFileError, string> = {
  notJson: "This file isn't a settings file: it isn't valid JSON.",
  wrongFormat: "This file isn't a Gramps Connect settings file.",
  newerVersion: "This settings file was made by a newer version of Gramps Connect.",
};

type Pending =
  | { kind: "load"; settings: Record<string, string>; skipped: number }
  | { kind: "reset" };

function download() {
  try {
    const json = JSON.stringify(exportLocalSettings(), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    clickDownloadLink(url, settingsFileName());
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    console.error("settings download failed", err);
    notifications.show({ color: "red", message: t("Couldn't read the settings stored in this browser.") });
  }
}

export function LocalSettingsSection() {
  const [pending, setPending] = useState<Pending | null>(null);

  async function chooseFile(file: File | null) {
    if (!file) return;
    try {
      const { settings, skipped } = parseSettingsFile(await file.text());
      setPending({ kind: "load", settings, skipped });
    } catch (err) {
      const message = err instanceof SettingsFileInvalid ? FILE_ERRORS[err.reason] : "Couldn't read this file.";
      notifications.show({ color: "red", message: t(message) });
    }
  }

  function confirm() {
    if (!pending) return;
    try {
      if (pending.kind === "load") importLocalSettings(pending.settings);
      else resetLocalSettings();
    } catch (err) {
      console.error("settings change failed", err);
      notifications.show({ color: "red", message: t("This browser isn't allowing settings to be saved.") });
      setPending(null);
      return;
    }
    window.location.reload();
  }

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{t("Settings in this browser")}</Text>
      <Text size="xs" c="dimmed">
        {t("Save these settings to a file, load them in another browser, or go back to the defaults. Your layout, window positions, search sites, home person and drafts are included; your sign-in, Visited history and the family tree's own preferences are not.")}
      </Text>
      <Group gap="xs" mt={4}>
        <Button variant="default" size="xs" onClick={download}>
          {t("Download settings")}
        </Button>
        <FileButton onChange={chooseFile} accept=".json,application/json">
          {(props) => (
            <Button variant="default" size="xs" {...props}>
              {t("Load settings…")}
            </Button>
          )}
        </FileButton>
        <Button variant="default" size="xs" color="red" onClick={() => setPending({ kind: "reset" })}>
          {t("Reset settings…")}
        </Button>
      </Group>
      {pending && (
        <Alert mt="xs" color={pending.kind === "reset" ? "red" : "blue"} variant="light">
          <Stack gap="xs">
            {pending.kind === "load" ? (
              <>
                <Text size="sm">
                  {t("Apply {count} settings from this file? Settings that aren't in the file stay as they are. The page will reload.").replace(
                    "{count}",
                    String(Object.keys(pending.settings).length),
                  )}
                </Text>
                {pending.skipped > 0 && (
                  <Text size="xs" c="dimmed">
                    {t("{count} entries in the file aren't settings this version knows, and will be skipped.").replace(
                      "{count}",
                      String(pending.skipped),
                    )}
                  </Text>
                )}
              </>
            ) : (
              <Text size="sm">
                {t("Reset all settings in this browser to their defaults? This also forgets your home person and any unsent blog post drafts, for every tree. Your Visited history and sign-in are kept. The page will reload.")}
              </Text>
            )}
            <Group gap="xs">
              <Button size="xs" color={pending.kind === "reset" ? "red" : undefined} onClick={confirm}>
                {pending.kind === "load" ? t("Load settings") : t("Reset settings")}
              </Button>
              <Button size="xs" variant="default" onClick={() => setPending(null)}>
                {t("Cancel")}
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
