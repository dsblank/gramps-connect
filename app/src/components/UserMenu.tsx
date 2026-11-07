import { useState, useSyncExternalStore } from "react";
import { Avatar, Menu } from "@mantine/core";
import { getApiKey, getCurrentUsername, hasPermissions, logout } from "../auth/auth";
import { openHandoffWindow } from "../auth/windowHandoff";
import { ProfileDialog } from "./ProfileDialog";
import { ApiKeysDialog } from "./ApiKeysDialog";
import { AdministrationDialog } from "./AdministrationDialog";
import { OwnerAdministrationDialog } from "./OwnerAdministrationDialog";
import { PreferencesDialog } from "./PreferencesDialog";
import { t } from "../i18n/i18n";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../store/userDirectory";
import { colorForUsername, initialsFor } from "../store/userAvatar";

/** Far-right account menu -- holds everything that isn't a family-tree
 * action: Preferences (first, for everyone: light/dark, language and the
 * desktop notifications and the tree's display settings --
 * PreferencesDialog.tsx), account dialogs, and sign-out. */
export function UserMenu() {
  const username = getCurrentUsername();
  // Re-renders once the own user's full name resolves (userDirectory.ts's
  // fetchOwnUser -- always available, no permission needed) so the avatar's
  // initials upgrade from the raw username without fetching anything here.
  useSyncExternalStore(subscribeUserDirectory, getUserDirectoryVersion);
  const initials = username ? initialsFor(displayName(username)) : "?";
  // New keys need EditOwnUser (every role has it); the old-server fallback
  // inside the dialog needs a session refresh token instead.
  const showApiKeys = hasPermissions("EditOwnUser") || getApiKey() !== null;
  const [preferencesOpened, setPreferencesOpened] = useState(false);
  const [profileOpened, setProfileOpened] = useState(false);
  const [apiKeysOpened, setApiKeysOpened] = useState(false);
  const [adminOpened, setAdminOpened] = useState(false);
  // ViewSettings is ROLE_ADMIN-only; ViewOtherUser is granted from
  // ROLE_OWNER up (and Admin has it too, since PERMISSIONS[ROLE_ADMIN] is a
  // superset of PERMISSIONS[ROLE_OWNER]) -- checking ViewSettings first
  // means an Admin always gets the full site-wide dialog, and an Owner (who
  // has ViewOtherUser but not ViewSettings) gets the own-tree-scoped one.
  const isSiteAdmin = hasPermissions("ViewSettings");
  const isOwner = hasPermissions("ViewOtherUser");

  return (
    <>
      <Menu shadow="md" width={220} position="bottom-end">
        <Menu.Target>
          <Avatar
            radius="xl"
            size="sm"
            variant="filled"
            color={username ? colorForUsername(username) : undefined}
            style={{ cursor: "pointer" }}
          >
            {initials}
          </Avatar>
        </Menu.Target>
        <Menu.Dropdown>
          {username && <Menu.Label>{username}</Menu.Label>}
          <Menu.Item onClick={() => setPreferencesOpened(true)}>{t("Preferences")}</Menu.Item>
          <Menu.Divider />
          {hasPermissions("EditOwnUser") && (
            <Menu.Item onClick={() => setProfileOpened(true)}>{t("Profile")}</Menu.Item>
          )}
          {(isSiteAdmin || isOwner) && (
            <Menu.Item onClick={() => setAdminOpened(true)}>{t("Administration")}</Menu.Item>
          )}
          {showApiKeys && <Menu.Item onClick={() => setApiKeysOpened(true)}>{t("API keys…")}</Menu.Item>}
          <Menu.Item onClick={openHandoffWindow}>{t("Open another window")}</Menu.Item>
          <Menu.Item onClick={logout}>{t("Sign out")}</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <PreferencesDialog opened={preferencesOpened} onClose={() => setPreferencesOpened(false)} />
      <ProfileDialog opened={profileOpened} onClose={() => setProfileOpened(false)} />
      <ApiKeysDialog opened={apiKeysOpened} onClose={() => setApiKeysOpened(false)} />
      {isSiteAdmin ? (
        <AdministrationDialog opened={adminOpened} onClose={() => setAdminOpened(false)} />
      ) : (
        <OwnerAdministrationDialog opened={adminOpened} onClose={() => setAdminOpened(false)} />
      )}
    </>
  );
}
