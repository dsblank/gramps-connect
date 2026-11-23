// Downloads this browser's settings (localSettings.ts) as a JSON file --
// Preferences > General's "Download settings", also offered by
// Family Trees > Make Backup… (MakeBackupDialog.tsx).
import { notifications } from "@mantine/notifications";
import { t } from "../i18n/i18n";
import { clickDownloadLink } from "./downloadFile";
import { exportLocalSettings, settingsFileName } from "./localSettings";

export function downloadLocalSettings() {
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
