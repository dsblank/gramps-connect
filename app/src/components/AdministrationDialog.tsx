import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, PasswordInput, Stack, Tabs, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken, hasPermissions } from "../auth/auth";
import { CONFIG_KEYS, type ConfigKey, deleteConfigValue, fetchConfig, setConfigValue } from "../store/adminApi";
import { UserManagementPanel } from "./UserManagementPanel";
import { t } from "../i18n/i18n";

interface AdministrationDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Site-wide administration, reachable from UserMenu.tsx and gated on
 * ViewSettings -- a ROLE_ADMIN-only permission (auth/const.py), so any user
 * who can even see the menu item already has every other ADMIN-tier
 * permission this dialog's two tabs need (ViewOtherTreeUser/
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
 * assigned to. */
export function AdministrationDialog({ opened, onClose }: AdministrationDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={t("Administration")} size="70rem">
      <Tabs defaultValue="users" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="users">{t("Users")}</Tabs.Tab>
          <Tabs.Tab value="settings">{t("Site settings")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="users" pt="sm">
          <UserManagementPanel active={opened} />
        </Tabs.Panel>
        <Tabs.Panel value="settings" pt="sm">
          <SiteSettingsTab active={opened} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

const PASSWORD_KEYS: ConfigKey[] = ["EMAIL_HOST_PASSWORD"];

function SiteSettingsTab({ active }: { active: boolean }) {
  const [values, setValues] = useState<Partial<Record<ConfigKey, string>>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<ConfigKey | null>(null);
  const [rowError, setRowError] = useState<Partial<Record<ConfigKey, string>>>({});

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const token = await getToken();
        setValues(await fetchConfig(token));
      } catch (err: any) {
        setLoadError(err.message ?? String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [active]);

  async function handleSave(key: ConfigKey) {
    setSavingKey(key);
    setRowError((prev) => ({ ...prev, [key]: undefined }));
    try {
      const token = await getToken();
      const value = values[key] ?? "";
      if (value) {
        await setConfigValue(token, key, value);
      } else {
        await deleteConfigValue(token, key);
      }
      notifications.show({ color: "green", message: t("Setting saved.") });
    } catch (err: any) {
      setRowError((prev) => ({ ...prev, [key]: err.message ?? String(err) }));
    } finally {
      setSavingKey(null);
    }
  }

  if (!hasPermissions("ViewSettings")) {
    return <Text size="sm" c="dimmed">{t("You don't have permission to view site settings.")}</Text>;
  }

  return (
    <Stack gap="sm">
      {loadError && <Alert color="red">{loadError}</Alert>}
      {CONFIG_KEYS.map((key) => (
        <Stack key={key} gap={4}>
          <Group align="flex-end" gap="xs" wrap="nowrap">
            {PASSWORD_KEYS.includes(key) ? (
              <PasswordInput
                label={key}
                style={{ flex: 1 }}
                value={values[key] ?? ""}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setValues((prev) => ({ ...prev, [key]: value }));
                }}
                disabled={loading || !hasPermissions("EditSettings")}
              />
            ) : (
              <TextInput
                label={key}
                style={{ flex: 1 }}
                value={values[key] ?? ""}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setValues((prev) => ({ ...prev, [key]: value }));
                }}
                disabled={loading || !hasPermissions("EditSettings")}
              />
            )}
            {hasPermissions("EditSettings") && (
              <Button size="sm" onClick={() => handleSave(key)} loading={savingKey === key}>
                {t("Save")}
              </Button>
            )}
          </Group>
          {rowError[key] && <Text size="xs" c="red">{rowError[key]}</Text>}
        </Stack>
      ))}
    </Stack>
  );
}

