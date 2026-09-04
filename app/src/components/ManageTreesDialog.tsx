import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Modal, ScrollArea, Stack, Table, Text, TextInput } from "@mantine/core";
import { getCurrentUsername, getToken, getTreeId, hasPermissions, refreshTokenNow } from "../auth/auth";
import { fetchMetadata } from "../store/metadataApi";
import { type Tree, createTree, fetchTrees, renameTree, setTreeEnabled, updateUser } from "../store/adminApi";
import { t } from "../i18n/i18n";

interface ManageTreesDialogProps {
  opened: boolean;
  onClose: () => void;
}

type SortKey = "name" | "people" | "status";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

/** Enabled trees sort before disabled ones ascending -- "Enabled" < 0 <
 * "Disabled" isn't alphabetical, it's most-relevant-first, matching how
 * status reads in the old TreesTab table (enabled trees are what an admin
 * usually cares about). */
function compareTrees(a: Tree, b: Tree, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "people":
      return (a.usage_people ?? -1) - (b.usage_people ?? -1);
    case "status":
      return Number(b.enabled) - Number(a.enabled);
  }
}

/** Desktop-Gramps-style "Family Trees" manager (~/gramps/gramps'
 * grampletdbman.py dialog: a selectable list with New/Rename/Disable actions
 * beside it), reachable from MenuBar.tsx's Family Trees menu. Lists every
 * tree the caller may see -- enabled and disabled alike, same as
 * AdministrationDialog.tsx's old Trees tab this replaces, since ViewOtherTree
 * (the permission gating this whole dialog) already returns both.
 *
 * Adds one thing that tab never had: "Select Family Tree" reassigns *this
 * admin's own account* to the highlighted tree (EditUserTree), then forces a
 * fresh token/reload so the app actually switches to it -- the same
 * self-edit path UserManagementPanel.tsx's afterUpdate takes, for the same
 * reason (the JWT's `tree` claim only gets re-derived on a fresh token). */
export function ManageTreesDialog({ opened, onClose }: ManageTreesDialogProps) {
  const [trees, setTrees] = useState<Tree[]>([]);
  const [multiTree, setMultiTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<"new" | "rename" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const sortedTrees = useMemo(() => {
    const sorted = [...trees].sort((a, b) => compareTrees(a, b, sort.key));
    return sort.dir === "asc" ? sorted : sorted.reverse();
  }, [trees, sort]);

  const canRename = hasPermissions("EditOtherTree");
  const canToggle = hasPermissions("DisableTree");
  const canCreate = hasPermissions("AddTree");
  const canSelect = hasPermissions("EditUserTree");

  const selected = trees.find((tree) => tree.id === selectedId) ?? null;
  const currentTreeId = getTreeId();

  async function reload() {
    setError(null);
    try {
      const token = await getToken();
      const [treeList, metadata] = await Promise.all([fetchTrees(token), fetchMetadata(token)]);
      setTrees(treeList);
      setMultiTree(metadata.server?.multi_tree ?? false);
      setSelectedId((prev) => (treeList.some((tree) => tree.id === prev) ? prev : null));
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  useEffect(() => {
    if (opened) {
      setPendingAction(null);
      setError(null);
      reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  function startNew() {
    setDraftName("");
    setPendingAction("new");
  }

  function startRename() {
    if (!selected) return;
    setDraftName(selected.name);
    setPendingAction("rename");
  }

  async function handleCreate() {
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const created = await createTree(token, name);
      await reload();
      setSelectedId(created.id);
      setPendingAction(null);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRename() {
    if (!selected) return;
    const name = draftName.trim();
    if (!name || name === selected.name) {
      setPendingAction(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await renameTree(token, selected.id, name);
      await reload();
      setPendingAction(null);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await setTreeEnabled(token, selected.id, !selected.enabled);
      await reload();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectTree() {
    const username = getCurrentUsername();
    if (!selected || !username) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await updateUser(token, username, { tree: selected.id });
      await refreshTokenNow();
      window.location.reload();
    } catch (err: any) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
  }

  if (!hasPermissions("ViewOtherTree")) return null;

  return (
    <Modal opened={opened} onClose={onClose} title={t("Family Trees")} size="45rem">
      <Stack gap="sm">
        {error && <Alert color="red">{error}</Alert>}
        {!multiTree && (
          <Alert color="yellow">
            {t("This server is running in single-tree mode: creating, enabling, or disabling trees is not available.")}
          </Alert>
        )}
        <Group align="flex-start" gap="sm" wrap="nowrap">
          <ScrollArea.Autosize mah={320} type="auto" style={{ flex: 1 }} offsetScrollbars>
            <Table.ScrollContainer minWidth={320}>
              <Table verticalSpacing={6} highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    {(
                      [
                        ["name", "Family Tree name"],
                        ["people", "People"],
                        ["status", "Status"],
                      ] as [SortKey, string][]
                    ).map(([key, label]) => (
                      <Table.Th
                        key={key}
                        onClick={() => toggleSort(key)}
                        style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                      >
                        {t(label)}
                        {sort.key === key && (
                          <Text span size="xs" c="dimmed" ml={4}>
                            {sort.dir === "asc" ? "▲" : "▼"}
                          </Text>
                        )}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sortedTrees.map((tree) => (
                    <Table.Tr
                      key={tree.id}
                      onClick={() => setSelectedId(tree.id)}
                      style={{
                        cursor: "pointer",
                        backgroundColor:
                          tree.id === selectedId ? "var(--mantine-color-blue-light)" : undefined,
                      }}
                    >
                      <Table.Td>
                        {tree.name}
                        {tree.id === currentTreeId && (
                          <Text span size="xs" c="dimmed">
                            {" "}
                            {t("(current)")}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{tree.usage_people ?? "—"}</Table.Td>
                      <Table.Td>
                        <Badge color={tree.enabled ? "green" : "gray"}>
                          {tree.enabled ? t("Enabled") : t("Disabled")}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </ScrollArea.Autosize>
          <Stack gap="xs">
            {canCreate && (
              <Button variant="default" size="sm" onClick={startNew} disabled={!multiTree || busy}>
                {t("New…")}
              </Button>
            )}
            {canRename && (
              <Button variant="default" size="sm" onClick={startRename} disabled={!selected || busy}>
                {t("Rename…")}
              </Button>
            )}
            {canToggle && (
              <Button
                variant="default"
                size="sm"
                onClick={handleToggleEnabled}
                loading={busy && pendingAction === null}
                disabled={!selected || !multiTree || busy}
              >
                {selected && !selected.enabled ? t("Enable") : t("Disable")}
              </Button>
            )}
          </Stack>
        </Group>
        {pendingAction && (
          <Group align="flex-end" gap="xs">
            <TextInput
              label={pendingAction === "new" ? t("New tree name") : t("Rename to")}
              value={draftName}
              onChange={(e) => setDraftName(e.currentTarget.value)}
              style={{ flex: 1 }}
              autoFocus
            />
            <Button
              onClick={pendingAction === "new" ? handleCreate : handleRename}
              loading={busy}
              disabled={!draftName.trim()}
            >
              {pendingAction === "new" ? t("Create") : t("Save")}
            </Button>
            <Button variant="default" onClick={() => setPendingAction(null)} disabled={busy}>
              {t("Cancel")}
            </Button>
          </Group>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            {t("Close")}
          </Button>
          {canSelect && (
            <Button
              onClick={handleSelectTree}
              loading={busy}
              disabled={!selected || !selected.enabled || selected.id === currentTreeId}
            >
              {t("Select Family Tree")}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
