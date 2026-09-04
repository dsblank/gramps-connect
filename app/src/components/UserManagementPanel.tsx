import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Modal, PasswordInput, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getCurrentUsername, getToken, hasPermissions, refreshTokenNow, setCurrentUsername } from "../auth/auth";
import {
  ROLE_LABELS, type AdminUser, type Tree,
  createUser, deleteUser, fetchAllUsers, fetchTrees, triggerPasswordReset, updateUser,
} from "../store/adminApi";
import { t } from "../i18n/i18n";

const ROLE_OPTIONS = Object.entries(ROLE_LABELS)
  .map(([value, label]) => ({ value, label: t(label) }))
  .sort((a, b) => Number(a.value) - Number(b.value));

/** A disabled tree 503s at login (token.py's get_tree_id_and_permissions())
 * -- assigning a user to one would just lock them out, so it's listed but
 * unselectable (with a label saying why) rather than a silent 403/omission,
 * matching the app's own "prevent, don't let it fail later" convention. A
 * user *already* on a disabled tree still shows correctly since Mantine
 * renders an unmatched `value` as-is; there's just no way to newly pick one. */
function treeSelectOptions(trees: Tree[]): { value: string; label: string; disabled: boolean }[] {
  return trees.map((tr) => ({
    value: tr.id,
    label: tr.enabled ? tr.name : `${tr.name} (${t("disabled")})`,
    disabled: !tr.enabled,
  }));
}

/** User list + add/edit-role/delete, shared by AdministrationDialog.tsx's
 * (ROLE_ADMIN) Users tab and OwnerAdministrationDialog.tsx's (ROLE_OWNER)
 * own-tree equivalent. One component works for both because GET
 * /api/users/ already scopes itself server-side: an Owner (who has
 * ViewOtherUser but not ViewOtherTreeUser) only ever gets back their own
 * tree's users, so there's no "wrong tree" row this component could show by
 * mistake -- it just needs to know whether *other* trees are in play at all
 * (hasPermissions("ViewOtherTree")) to decide whether the Tree column and
 * tree-picker are worth showing.
 *
 * Every action check follows the same "own-tree perm OR other-tree perm"
 * shape (e.g. EditUserRole || EditOtherTreeUserRole) -- for an Owner only
 * the own-tree half is ever true, and since every row they see is already
 * their own tree, that's always sufficient; for an Admin both halves are
 * true together (PERMISSIONS[ROLE_ADMIN] is a superset of
 * PERMISSIONS[ROLE_OWNER]), so checking either is equivalent to checking
 * both. This mirrors the app-wide "hide, never show-then-403" convention
 * without the component needing to know which tree each row belongs to. */
export function UserManagementPanel({ active }: { active: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  const canManageOtherTrees = hasPermissions("ViewOtherTree");
  const canEditTree = hasPermissions("EditUserTree");
  const canAdd = hasPermissions("AddUser") || hasPermissions("AddOtherTreeUser");
  const canEditRole = hasPermissions("EditUserRole") || hasPermissions("EditOtherTreeUserRole");
  const canEditProfile = hasPermissions("EditOtherUser") || hasPermissions("EditOtherTreeUser");
  const canDelete = hasPermissions("DeleteUser") || hasPermissions("DeleteOtherTreeUser");
  // MakeAdmin is the permission that lets someone *grant* the Administrator
  // role (see UserResource.put's "role >= ROLE_ADMIN" check in user.py) --
  // it's ROLE_ADMIN-only, so an Owner never has it. The backend's own
  // per-field permission checks don't actually stop an Owner from editing
  // or deleting an Administrator's account otherwise (prepare_edit() only
  // checks tree match, not the target's role), so this is an
  // app-side-only policy: someone who can't even promote a user to
  // Administrator shouldn't be able to touch an existing Administrator's
  // account at all, including changing them out of that role.
  const canManageAdmins = hasPermissions("MakeAdmin");

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const [userList, treeList] = await Promise.all([
        fetchAllUsers(token),
        canManageOtherTrees ? fetchTrees(token) : Promise.resolve([]),
      ]);
      setUsers(userList);
      setTrees(treeList);
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

  // gramps-web-api bakes `tree` and `permissions` into the JWT at login/
  // refresh time (token.py's get_tree_id_and_permissions()) -- editing the
  // *caller's own* row changes facts their already-cached access token is
  // now wrong about, and that token won't naturally refresh for up to 15
  // minutes (auth.ts's getToken() only refreshes when nearly expired). A
  // plain reload() wouldn't help either, since it'd just reuse the same
  // stale cached token -- refreshTokenNow() forces a new one (which
  // re-derives both claims from the database), then the reload restarts the
  // app on it, matching the "local state is now stale" reload every other
  // tree-mutating dialog in this app already does (DeleteAllDialog.tsx,
  // ImportDialog.tsx, RestoreBackupDialog.tsx).
  async function afterUpdate(user: AdminUser) {
    if (user.name === getCurrentUsername()) {
      await refreshTokenNow();
      window.location.reload();
      return;
    }
    await reload();
  }

  async function handleRoleChange(user: AdminUser, role: number) {
    setBusyName(user.name);
    setError(null);
    try {
      const token = await getToken();
      await updateUser(token, user.name, { role });
      await afterUpdate(user);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusyName(null);
    }
  }

  async function handleTreeChange(user: AdminUser, tree: string) {
    setBusyName(user.name);
    setError(null);
    try {
      const token = await getToken();
      await updateUser(token, user.name, { tree });
      await afterUpdate(user);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusyName(null);
    }
  }

  async function handleDelete(user: AdminUser) {
    if (!window.confirm(`Delete user "${user.name}"? There is no undo.`)) return;
    setBusyName(user.name);
    setError(null);
    try {
      const token = await getToken();
      await deleteUser(token, user.name);
      await reload();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusyName(null);
    }
  }

  if (!hasPermissions("ViewOtherUser")) {
    return <Text size="sm" c="dimmed">{t("You don't have permission to view other users.")}</Text>;
  }

  return (
    <Stack gap="sm">
      {error && <Alert color="red">{error}</Alert>}
      <Table verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("Name")}</Table.Th>
            <Table.Th>{t("Full name")}</Table.Th>
            <Table.Th>{t("Email")}</Table.Th>
            {canManageOtherTrees && <Table.Th>{t("Tree")}</Table.Th>}
            <Table.Th>{t("Role")}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((user) => {
            const isProtectedAdmin = user.role >= 5 && !canManageAdmins;
            return (
            <Table.Tr key={user.name}>
              <Table.Td>{user.name}</Table.Td>
              <Table.Td>{user.full_name}</Table.Td>
              <Table.Td>{user.email}</Table.Td>
              {canManageOtherTrees && (
                <Table.Td>
                  {canEditTree ? (
                    <Stack gap={2}>
                      <Select
                        size="xs"
                        w={160}
                        placeholder={t("No tree")}
                        data={treeSelectOptions(trees)}
                        value={user.tree ?? null}
                        onChange={(value) => value && handleTreeChange(user, value)}
                        disabled={busyName === user.name}
                        comboboxProps={{ withinPortal: true, width: 220 }}
                      />
                      {user.tree && !trees.some((tr) => tr.id === user.tree) && (
                        <Badge
                          color="red"
                          variant="light"
                          title={t("This user references a tree that no longer exists.")}
                        >
                          {t("Missing tree")}: {user.tree}
                        </Badge>
                      )}
                    </Stack>
                  ) : !user.tree ? (
                    "—"
                  ) : (
                    (() => {
                      const tree = trees.find((tr) => tr.id === user.tree);
                      return tree ? (
                        tree.name
                      ) : (
                        <Badge
                          color="red"
                          variant="light"
                          title={t("This user references a tree that no longer exists.")}
                        >
                          {t("Missing tree")}: {user.tree}
                        </Badge>
                      );
                    })()
                  )}
                </Table.Td>
              )}
              <Table.Td>
                {isProtectedAdmin ? (
                  t(ROLE_LABELS[user.role])
                ) : (
                  <Select
                    size="xs"
                    w={150}
                    data={ROLE_OPTIONS.filter((opt) => Number(opt.value) < 5 || hasPermissions("MakeAdmin"))}
                    value={String(user.role)}
                    onChange={(value) => value && handleRoleChange(user, Number(value))}
                    disabled={busyName === user.name || !canEditRole}
                    allowDeselect={false}
                    comboboxProps={{ withinPortal: true, width: 180 }}
                  />
                )}
              </Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  {canEditProfile && !isProtectedAdmin && (
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={busyName === user.name}
                      onClick={() => setEditingUser(user)}
                    >
                      {t("Edit")}
                    </Button>
                  )}
                  {canDelete && !isProtectedAdmin && (
                    <Button
                      size="xs"
                      color="red"
                      variant="subtle"
                      loading={busyName === user.name}
                      onClick={() => handleDelete(user)}
                    >
                      {t("Delete")}
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      {canAdd && (
        <>
          <Group>
            <Button size="sm" variant="default" onClick={() => setShowCreate((prev) => !prev)}>
              {showCreate ? t("Cancel") : t("Add user")}
            </Button>
          </Group>
          {showCreate && (
            <NewUserForm
              trees={trees}
              requireTree={canManageOtherTrees}
              onCreated={() => {
                setShowCreate(false);
                reload();
              }}
            />
          )}
        </>
      )}
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={async (newName) => {
            const saved = editingUser;
            const isSelf = saved.name === getCurrentUsername();
            setEditingUser(null);
            if (isSelf && newName !== saved.name) {
              // Keep the cached username in sync before reloading -- same
              // reasoning as ProfileDialog.tsx's own setCurrentUsername()
              // call after a self-rename, otherwise the reload would come
              // back up still reading the old name out of storage.
              setCurrentUsername(newName);
            }
            if (isSelf) {
              await refreshTokenNow();
              window.location.reload();
              return;
            }
            await reload();
          }}
        />
      )}
    </Stack>
  );
}

/** Username/full name/email + a password-reset trigger for another user --
 * separate from the always-visible role/tree Selects in the table itself
 * since these need a different permission (EditOtherUser/EditOtherTreeUser,
 * not EditUserRole/EditUserTree) and there's no server-side way to set an
 * arbitrary new password for someone else (PUT /api/users/<name>/ has no
 * password field, and the "change password" endpoint requires knowing the
 * *current* one) -- the reset-email trigger is the only admin/owner-
 * initiated path to a changed password. */
function EditUserDialog({
  user, onClose, onSaved,
}: { user: AdminUser; onClose: () => void; onSaved: (newName: string) => void }) {
  const [name, setName] = useState(user.name);
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const token = await getToken();
      await updateUser(token, user.name, {
        full_name: fullName,
        email,
        ...(name !== user.name ? { name_new: name } : {}),
      });
      onSaved(name);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSendReset() {
    setError(null);
    setSendingReset(true);
    try {
      const token = await getToken();
      await triggerPasswordReset(token, user.name);
      notifications.show({
        color: "green",
        message: t("If this user has a registered email address, a password reset link was sent."),
      });
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={t("Edit user")} size="sm">
      <Stack gap="sm">
        <TextInput label={t("Username")} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label={t("Full name")} value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
        <TextInput label={t("Email")} type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="space-between">
          <Button variant="default" loading={sendingReset} onClick={handleSendReset}>
            {t("Send password reset email")}
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>{t("Cancel")}</Button>
            <Button onClick={handleSave} loading={saving} disabled={!name.trim() || !fullName.trim()}>
              {t("Save")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

function NewUserForm({
  trees, requireTree, onCreated,
}: { trees: Tree[]; requireTree: boolean; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("1");
  const [treeId, setTreeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A treeless user is only valid for role >= ROLE_ADMIN (5) -- see
  // adminApi.ts/user.py's own "only admins may be treeless" rule -- so an
  // Owner (requireTree=false, never offers role 5 anyway) never needs the
  // picker at all: the server defaults a missing `tree` to the caller's own.
  const treeRequired = requireTree && Number(role) < 5;

  async function handleCreate() {
    setError(null);
    if (treeRequired && !treeId) {
      setError(t("A tree is required for this role."));
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      await createUser(token, {
        name,
        full_name: fullName,
        email,
        password,
        role: Number(role),
        tree: treeId ?? undefined,
      });
      notifications.show({ color: "green", message: t("User created.") });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="xs" p="sm" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 4 }}>
      <TextInput label={t("Username")} value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <TextInput label={t("Full name")} value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
      <TextInput label={t("Email")} type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
      <PasswordInput label={t("Password")} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
      <Select
        label={t("Role")}
        data={ROLE_OPTIONS.filter((opt) => Number(opt.value) < 5 || hasPermissions("MakeAdmin"))}
        value={role}
        onChange={(value) => value && setRole(value)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      {treeRequired && (
        <Select
          label={t("Tree")}
          data={treeSelectOptions(trees)}
          value={treeId}
          onChange={setTreeId}
          comboboxProps={{ withinPortal: true }}
        />
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button
          onClick={handleCreate}
          loading={saving}
          disabled={!name || !fullName || !email || !password}
        >
          {t("Create")}
        </Button>
      </Group>
    </Stack>
  );
}
