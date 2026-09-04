import { useEffect, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Group, Modal, PasswordInput,
  Stack, Table, Tabs, Text, TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken, hasPermissions } from "../auth/auth";
import { fetchMetadata } from "../store/metadataApi";
import {
  CONFIG_KEYS, type ConfigKey, type Tree,
  createTree, deleteConfigValue, fetchConfig, fetchTrees, renameTree, setConfigValue, setTreeEnabled,
} from "../store/adminApi";
import { UserManagementPanel } from "./UserManagementPanel";
import { t } from "../i18n/i18n";

interface AdministrationDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Site-wide administration, reachable from UserMenu.tsx and gated on
 * ViewSettings -- a ROLE_ADMIN-only permission (auth/const.py), so any user
 * who can even see the menu item already has every other ADMIN-tier
 * permission this dialog's three tabs need (ViewOtherTree/AddTree/
 * DisableTree, ViewOtherTreeUser/AddOtherTreeUser/EditOtherTreeUser(Role)/
 * DeleteOtherTreeUser/EditUserTree/MakeAdmin) -- they're all granted
 * together at that role, unlike the ROLE_OWNER-level per-tree maintenance
 * actions (reindex, repair, upgrade schema, restore-from-backup,
 * delete-all-objects) that this dialog deliberately excludes: those are a
 * separate, lower bar (OWNER) scoped to one tree, not "administration over
 * the entire app". */
export function AdministrationDialog({ opened, onClose }: AdministrationDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={t("Administration")} size="70rem">
      <Tabs defaultValue="settings" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="settings">{t("Site settings")}</Tabs.Tab>
          <Tabs.Tab value="trees">{t("Trees")}</Tabs.Tab>
          <Tabs.Tab value="users">{t("Users")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="settings" pt="sm">
          <SiteSettingsTab active={opened} />
        </Tabs.Panel>
        <Tabs.Panel value="trees" pt="sm">
          <TreesTab active={opened} />
        </Tabs.Panel>
        <Tabs.Panel value="users" pt="sm">
          <UserManagementPanel active={opened} />
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

function TreesTab({ active }: { active: boolean }) {
  const [trees, setTrees] = useState<Tree[]>([]);
  const [multiTree, setMultiTree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const [treeList, metadata] = await Promise.all([fetchTrees(token), fetchMetadata(token)]);
      setTrees(treeList);
      setMultiTree(metadata.server?.multi_tree ?? false);
      setRenameDrafts(Object.fromEntries(treeList.map((tr) => [tr.id, tr.name])));
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      await createTree(token, newName);
      setNewName("");
      await reload();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleEnabled(tree: Tree) {
    setBusyId(tree.id);
    setError(null);
    try {
      const token = await getToken();
      await setTreeEnabled(token, tree.id, !tree.enabled);
      await reload();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(tree: Tree) {
    const name = renameDrafts[tree.id]?.trim();
    if (!name || name === tree.name) return;
    setBusyId(tree.id);
    setError(null);
    try {
      const token = await getToken();
      await renameTree(token, tree.id, name);
      await reload();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!hasPermissions("ViewOtherTree")) {
    return <Text size="sm" c="dimmed">{t("You don't have permission to view other trees.")}</Text>;
  }

  return (
    <Stack gap="sm">
      {error && <Alert color="red">{error}</Alert>}
      {!multiTree && (
        <Alert color="yellow">
          {t("This server is running in single-tree mode: creating, enabling, or disabling trees is not available.")}
        </Alert>
      )}
      <Table verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("Name")}</Table.Th>
            <Table.Th>{t("People")}</Table.Th>
            <Table.Th>{t("Status")}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {trees.map((tree) => (
            <Table.Tr key={tree.id}>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  <TextInput
                    size="xs"
                    value={renameDrafts[tree.id] ?? ""}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setRenameDrafts((prev) => ({ ...prev, [tree.id]: value }));
                    }}
                    disabled={!hasPermissions("EditOtherTree")}
                  />
                  {hasPermissions("EditOtherTree") && renameDrafts[tree.id] !== tree.name && (
                    <ActionIcon
                      variant="subtle"
                      loading={busyId === tree.id}
                      onClick={() => handleRename(tree)}
                      aria-label={t("Save name")}
                    >
                      ✓
                    </ActionIcon>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>{tree.usage_people ?? "—"}</Table.Td>
              <Table.Td>
                <Badge color={tree.enabled ? "green" : "gray"}>{tree.enabled ? t("Enabled") : t("Disabled")}</Badge>
              </Table.Td>
              <Table.Td>
                {hasPermissions("DisableTree") && multiTree && (
                  <Button
                    size="xs"
                    variant="default"
                    loading={busyId === tree.id}
                    onClick={() => handleToggleEnabled(tree)}
                  >
                    {tree.enabled ? t("Disable") : t("Enable")}
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {hasPermissions("AddTree") && multiTree && (
        <Group align="flex-end" gap="xs">
          <TextInput
            label={t("New tree name")}
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
          />
          <Button onClick={handleCreate} loading={creating} disabled={!newName.trim()}>
            {t("Create tree")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

