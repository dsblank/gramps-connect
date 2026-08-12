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
import { getCurrentUsername, logout } from "../auth/auth";
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
export function UserMenu() {
  const username = getCurrentUsername();
  const initial = username ? username[0].toUpperCase() : "?";

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
        <Menu.Item onClick={logout}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
