import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel";
import { LocalSettingsSection } from "./LocalSettingsSection";
import { getI18nSnapshot, setLanguage, subscribe as subscribeI18n, t } from "../i18n/i18n";
import { fetchLanguages } from "../store/translationsApi";
import {
  browserNotificationsBlocker,
  disableBrowserNotifications,
  enableBrowserNotifications,
  isBrowserNotificationsEnabled,
  type NotificationBlocker,
} from "../store/browserNotifications";

const BLOCKER_MESSAGES: Record<NotificationBlocker, string> = {
  insecure: "Not available here: browsers only allow notifications on a secure (https://) connection.",
  unsupported: "This browser doesn't support notifications.",
  denied: "Your browser has blocked notifications for this site. Allow them in the browser's site settings, then turn this on again.",
};

const ENGLISH_OPTION = { value: "en", label: "English" };

/** Cached across mounts, same dedup pattern as MenuBar.tsx's reportsPromise
 * -- fixed for the life of the session (which locales are bootstrapped
 * doesn't change without a redeploy, and neither does the server's
 * installed `gramps` build), so there's nothing to invalidate. */
let languageOptionsPromise: Promise<{ value: string; label: string }[]> | null = null;

/** The language picker's options: the intersection of "locales this app has
 * static frontend/addons strings for" (app/public/lang/index.json, written
 * by scripts/bootstrap-translations.py) and "locales this server's
 * installed gramps build can live-translate the desktop vocabulary into"
 * (GET /api/translations/) -- offering a language missing from either side
 * would translate only some of the app rather than silently do nothing, so
 * the intersection is the honest "will visibly do something" set. Native
 * names come from the server rather than a hardcoded list here, the same
 * way gramps-web's own language picker gets them
 * (GrampsjsViewSettingsUser.js's _fetchDataLang()). */
function loadLanguageOptions(): Promise<{ value: string; label: string }[]> {
  if (!languageOptionsPromise) {
    languageOptionsPromise = (async () => {
      const [available, languages] = await Promise.all([
        fetch("/lang/index.json").then((res) => (res.ok ? res.json() : [])).catch(() => [] as string[]),
        fetchLanguages(),
      ]);
      const availableSet = new Set<string>(available);
      const options = languages
        .filter((l) => availableSet.has(l.language))
        .map((l) => ({ value: l.language, label: l.native }));
      return [ENGLISH_OPTION, ...options];
    })().catch((err) => {
      languageOptionsPromise = null;
      throw err;
    });
  }
  return languageOptionsPromise;
}

function LanguagePicker() {
  const { lang } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const [options, setOptions] = useState([ENGLISH_OPTION]);
  useEffect(() => {
    loadLanguageOptions()
      .then(setOptions)
      .catch((err) => console.error("failed to load language list", err));
  }, []);
  return (
    <Select
      label={t("Language")}
      w={260}
      data={options}
      value={lang}
      onChange={(value) => value && setLanguage(value)}
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

/** Light, Dark, or Auto -- following the computer's own setting (the
 * app's default, main.tsx's defaultColorScheme="auto"). Mantine keeps the
 * choice in localStorage. */
function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{t("Appearance")}</Text>
      <SegmentedControl
        w={300}
        value={colorScheme}
        onChange={(value) => setColorScheme(value as "light" | "dark" | "auto")}
        data={[
          { label: t("Light"), value: "light" },
          { label: t("Dark"), value: "dark" },
          { label: t("Auto"), value: "auto" },
        ]}
      />
      {colorScheme === "auto" && (
        <Text size="xs" c="dimmed">{t("Follows your computer's light or dark setting.")}</Text>
      )}
    </Stack>
  );
}

/** Toggle for the opt-in browser Notification side-channel -- separate from
 * Mantine's own in-app toast (always on), this is the "also notify me even
 * if this tab isn't focused" escalation, and browsers require it to be
 * requested from a real click. */
function BrowserNotificationsToggle() {
  // Read fresh on open: the browser's own permission can change behind our
  // back (blocked in site settings), which would leave a stored "on" that
  // silently does nothing -- shown as off, with the reason, instead.
  const [blocker, setBlocker] = useState(browserNotificationsBlocker);
  const [enabled, setEnabled] = useState(() => isBrowserNotificationsEnabled() && browserNotificationsBlocker() === null);
  return (
    <Stack gap={4}>
      <Switch
        label={t("Desktop notifications")}
        description={t("Also show alerts (new messages, finished reports and downloads) as notifications from your computer, while Gramps Connect is open in a tab.")}
        checked={enabled}
        disabled={blocker === "insecure" || blocker === "unsupported"}
        onChange={async (e) => {
          if (e.currentTarget.checked) {
            const granted = await enableBrowserNotifications();
            setEnabled(granted);
            setBlocker(granted ? null : browserNotificationsBlocker() ?? "denied");
          } else {
            disableBrowserNotifications();
            setEnabled(false);
          }
        }}
      />
      {blocker && (
        <Text size="xs" c="orange">
          {t(BLOCKER_MESSAGES[blocker])}
        </Text>
      )}
    </Stack>
  );
}

interface PreferencesDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Edit > Preferences' counterpart, first in UserMenu.tsx for every user.
 * Two tabs, because the two halves are saved in very different places:
 * - General: this browser's own choices (light/dark, language, desktop
 *   notifications), kept in localStorage and applied immediately -- no Save.
 *   Ends with LocalSettingsSection's Download / Load / Reset settings.
 * - Family tree: DisplaySettingsPanel.tsx, the tree-wide settings stored in
 *   /api/trees/-/config. Everyone can read them (they shape everything the
 *   app shows); only EditTree (Owner/Admin) can change them -- the panel
 *   goes read-only otherwise. */
export function PreferencesDialog({ opened, onClose }: PreferencesDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={t("Preferences")} size="60rem">
      <Tabs defaultValue="general" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="general">{t("General")}</Tabs.Tab>
          <Tabs.Tab value="tree">{t("Family tree")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general" pt="sm">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("These settings are just for you, in this browser.")}
            </Text>
            <ColorSchemeToggle />
            <LanguagePicker />
            <BrowserNotificationsToggle />
            <LocalSettingsSection />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="tree" pt="sm">
          <DisplaySettingsPanel active={opened} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
