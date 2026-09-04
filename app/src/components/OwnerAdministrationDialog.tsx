import { useEffect, useState } from "react";
import { ActionIcon, Alert, Modal, Stack, Tabs, Text, TextInput } from "@mantine/core";
import { getToken, hasPermissions } from "../auth/auth";
import { fetchTrees, renameTree, type Tree } from "../store/adminApi";
import { UserManagementPanel } from "./UserManagementPanel";
import { t } from "../i18n/i18n";

interface OwnerAdministrationDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Administration for a ROLE_OWNER, shown from UserMenu.tsx instead of the
 * full AdministrationDialog.tsx when the current user has ViewOtherUser but
 * not ViewSettings (i.e. Owner, not site-wide Admin) -- see auth/const.py's
 * PERMISSIONS chain: an Owner has EditTree/AddUser/EditOtherUser/
 * EditUserRole/DeleteUser/ViewOtherUser for their *own* tree only, none of
 * the ADMIN-tier cross-tree or site-settings permissions. Reuses
 * UserManagementPanel.tsx unchanged -- GET /api/users/ already scopes
 * itself to the caller's own tree when ViewOtherTreeUser is absent, so the
 * same component naturally shows no Tree column and no tree picker here. */
export function OwnerAdministrationDialog({ opened, onClose }: OwnerAdministrationDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={t("Administration")} size="60rem">
      <Tabs defaultValue="tree" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="tree">{t("My Tree")}</Tabs.Tab>
          <Tabs.Tab value="users">{t("Users")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="tree" pt="sm">
          <OwnTreeTab active={opened} />
        </Tabs.Panel>
        <Tabs.Panel value="users" pt="sm">
          <UserManagementPanel active={opened} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

function OwnTreeTab({ active }: { active: boolean }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const token = await getToken();
        // Without ViewOtherTree, TreesResource.get() falls back to just the
        // caller's own tree -- the same endpoint AdministrationDialog.tsx's
        // Trees tab uses for the all-trees case.
        const [own] = await fetchTrees(token);
        setTree(own ?? null);
        setName(own?.name ?? "");
      } catch (err: any) {
        setError(err.message ?? String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [active]);

  async function handleRename() {
    if (!tree) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === tree.name) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await renameTree(token, tree.id, trimmed);
      setTree({ ...tree, name: trimmed });
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (error) return <Alert color="red">{error}</Alert>;
  if (!tree) return <Text size="sm" c="dimmed">{t("No tree information available.")}</Text>;

  return (
    <Stack gap="sm">
      <TextInput
        label={t("Tree name")}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        disabled={!hasPermissions("EditTree") || saving}
        rightSection={
          hasPermissions("EditTree") && name.trim() !== tree.name ? (
            <ActionIcon variant="subtle" loading={saving} onClick={handleRename} aria-label={t("Save name")}>
              ✓
            </ActionIcon>
          ) : undefined
        }
      />
      <Text size="sm" c="dimmed">
        {t("People")}: {tree.usage_people ?? "—"}
        {tree.quota_people != null && ` / ${tree.quota_people}`}
      </Text>
      <Text size="sm" c="dimmed">
        {t("Media size")}: {tree.usage_media ?? "—"}
        {tree.quota_media != null && ` / ${tree.quota_media}`}
      </Text>
    </Stack>
  );
}
