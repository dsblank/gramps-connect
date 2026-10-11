import { Modal, Tabs } from "@mantine/core";
import { UserManagementPanel } from "./UserManagementPanel";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel";
import { t } from "../i18n/i18n";

interface AdministrationDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Site-wide administration, reachable from UserMenu.tsx and gated on
 * ViewSettings -- a ROLE_ADMIN-only permission (auth/const.py), so any user
 * who can even see the menu item already has every other ADMIN-tier
 * permission this dialog's Users tab needs (ViewOtherTreeUser/
 * AddOtherTreeUser/EditOtherTreeUser(Role)/DeleteOtherTreeUser/
 * EditUserTree/MakeAdmin) -- they're all granted together at that role,
 * unlike the ROLE_OWNER-level per-tree maintenance actions (reindex, repair,
 * upgrade schema, restore-from-backup, delete-all-objects) that this dialog
 * deliberately excludes: those are a separate, lower bar (OWNER) scoped to
 * one tree, not "administration over the entire app". Tree management
 * itself (create/rename/enable/disable, ViewOtherTree/AddTree/
 * EditOtherTree/DisableTree) moved to MenuBar.tsx's "Manage Family Trees…",
 * a standalone dialog (ManageTreesDialog.tsx) rather than a tab here -- it
 * also needs to be reachable without opening Administration at all, since it
 * doubles as the way an admin switches which tree their own account is
 * assigned to. The Preferences tab is the one per-tree exception: it's the same
 * DisplaySettingsPanel.tsx OwnerAdministrationDialog.tsx shows, kept here
 * too so an admin can reach their own tree's display settings. */
export function AdministrationDialog({ opened, onClose }: AdministrationDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={t("Administration")} size="70rem">
      <Tabs defaultValue="users" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="users">{t("Users")}</Tabs.Tab>
          <Tabs.Tab value="preferences">{t("Preferences")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="users" pt="sm">
          <UserManagementPanel active={opened} />
        </Tabs.Panel>
        <Tabs.Panel value="preferences" pt="sm">
          <DisplaySettingsPanel active={opened} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
