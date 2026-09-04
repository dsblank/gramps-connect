import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Avatar,
  Menu,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getApiKey, getCurrentUsername, hasPermissions, logout } from "../auth/auth";
import { ProfileDialog } from "./ProfileDialog";
import { getI18nSnapshot, setLanguage, subscribe as subscribeI18n, t } from "../i18n/i18n";
import { fetchLanguages } from "../store/translationsApi";
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  isBrowserNotificationsEnabled,
} from "../store/browserNotifications";

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
      size="xs"
      data={options}
      value={lang}
      onChange={(value) => value && setLanguage(value)}
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  return (
    <SegmentedControl
      size="xs"
      value={computed}
      onChange={(value) => setColorScheme(value as "light" | "dark")}
      data={[
        { label: t("Light"), value: "light" },
        { label: t("Dark"), value: "dark" },
      ]}
    />
  );
}

/** Toggle for the opt-in browser Notification side-channel -- separate from
 * Mantine's own in-app toast (always on), this is the "also notify me even
 * if this tab isn't focused" escalation, and browsers require it to be
 * requested from a real click. */
function BrowserNotificationsToggle() {
  const [enabled, setEnabled] = useState(isBrowserNotificationsEnabled);
  return (
    <Switch
      size="xs"
      label={t("Desktop notifications")}
      checked={enabled}
      onChange={async (e) => {
        if (e.currentTarget.checked) {
          setEnabled(await enableBrowserNotifications());
        } else {
          disableBrowserNotifications();
          setEnabled(false);
        }
      }}
    />
  );
}

/** Far-right account menu -- holds everything that isn't a family-tree
 * action: the two session-scoped toggles that used to sit loose in the
 * header (moved here to leave room for the growing MenuBar), and sign-out.
 * Plain rows rather than Menu.Item for the toggles, since Mantine only
 * closes the dropdown on Menu.Item clicks -- flipping a Switch or
 * SegmentedControl shouldn't dismiss the menu. More account-level items
 * (profile, preferences, ...) land here later. */
/** Puts this session's GRAMPS_WEB_API_KEY on the clipboard, for pasting into
 * gramps-api-client (`Client.from_env()`) or any other script that speaks the
 * same key format -- saving a separate `gramps-api-client generate-key` login.
 * The key is the session's non-expiring refresh token (see getApiKey()), so
 * the notification says out loud that it's password-equivalent and that only
 * a password change retires a leaked copy. */
async function copyApiKey() {
  const apiKey = getApiKey();
  if (!apiKey) return;
  try {
    await navigator.clipboard.writeText(apiKey);
  } catch {
    // Clipboard access needs a secure context (https or localhost); on a
    // plain-http deployment there's nothing to fall back to.
    notifications.show({
      color: "red",
      title: "Couldn't copy API key",
      message: "The clipboard is unavailable in this browser context.",
    });
    return;
  }
  notifications.show({
    color: "yellow",
    title: "API key copied",
    message:
      "Set it as GRAMPS_WEB_API_KEY. It grants full access to your account " +
      "and never expires -- treat it like a password; changing your password " +
      "is the only way to revoke it.",
    autoClose: 10000,
  });
}

export function UserMenu() {
  const username = getCurrentUsername();
  const initial = username ? username[0].toUpperCase() : "?";
  const hasApiKey = getApiKey() !== null;
  const [profileOpened, setProfileOpened] = useState(false);

  return (
    <>
      <Menu shadow="md" width={220} position="bottom-end">
        <Menu.Target>
          <Avatar radius="xl" size="sm" style={{ cursor: "pointer" }}>
            {initial}
          </Avatar>
        </Menu.Target>
        <Menu.Dropdown>
          {username && <Menu.Label>{username}</Menu.Label>}
          <Stack gap="sm" px="sm" py={4}>
            <BrowserNotificationsToggle />
            <ColorSchemeToggle />
            <LanguagePicker />
          </Stack>
          <Menu.Divider />
          {hasPermissions("EditOwnUser") && (
            <Menu.Item onClick={() => setProfileOpened(true)}>{t("Profile")}</Menu.Item>
          )}
          {hasApiKey && <Menu.Item onClick={copyApiKey}>{t("Copy API key")}</Menu.Item>}
          <Menu.Item onClick={logout}>{t("Sign out")}</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <ProfileDialog opened={profileOpened} onClose={() => setProfileOpened(false)} />
    </>
  );
}
