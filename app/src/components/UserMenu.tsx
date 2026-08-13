import { useState } from "react";
import {
  Avatar,
  Menu,
  SegmentedControl,
  Stack,
  Switch,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getApiKey, getCurrentUsername, logout } from "../auth/auth";
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  isBrowserNotificationsEnabled,
} from "../store/browserNotifications";

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  return (
    <SegmentedControl
      size="xs"
      value={computed}
      onChange={(value) => setColorScheme(value as "light" | "dark")}
      data={[
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
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
      label="Desktop notifications"
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

  return (
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
        </Stack>
        <Menu.Divider />
        {hasApiKey && <Menu.Item onClick={copyApiKey}>Copy API key</Menu.Item>}
        <Menu.Item onClick={logout}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
