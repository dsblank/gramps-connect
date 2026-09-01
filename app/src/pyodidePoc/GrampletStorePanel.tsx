// Browse the Gramplet Store's catalog (gramplet-store/catalog.json, see
// grampletStore.ts's own top comment) and install/update/remove Gramplets
// from it. Opened from MenuBar.tsx's Help menu ("Gramplet Store…"), gated
// on the same GRAMPLET_AUTHOR_PERMISSION as the Add menu's "Add Gramplet…" --
// see grampletMedia.ts's own doc comment for why authoring needs a higher
// bar than ordinary Media edit rights. A single flat list rather than
// Mantine's Accordion (not used anywhere else in this codebase) -- Card +
// an inline Collapse-on-click detail, the same "> Options" disclosure
// pattern ExportDialog.tsx already uses, kept consistent rather than
// introducing a new component family for one dialog.
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Collapse, Group, Loader, Modal, Stack, Text, TextInput } from "@mantine/core";
import { canAuthorGramplets, fetchGramplets } from "./grampletMedia";
import {
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  findInstalledEntry,
  hasCatalogUpdate,
  installFromCatalog,
  removeGramplet,
  resolveCatalogAssetUrl,
  updateFromCatalog,
  wasEditedSinceInstall,
} from "./grampletStore";
import { PythonCodeEditor } from "./PythonCodeEditor";
import { t } from "../i18n/i18n";
import type { CatalogEntry, Gramplet } from "./types";

type LoadStatus = "loading" | "ready" | "error";

/** Matches CatalogEntry.category/author/name against `query`, case-
 * insensitive -- a plain substring filter is plenty for a few dozen
 * entries; nothing here needs FilterBar's own GOQL machinery. */
function matches(entry: CatalogEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    entry.name.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q) ||
    entry.category.toLowerCase().includes(q) ||
    entry.author.toLowerCase().includes(q)
  );
}

export function GrampletStorePanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [installed, setInstalled] = useState<Gramplet[]>([]);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which entry's Install/Update/Remove button is mid-request -- disables
  // just that one row's buttons rather than the whole dialog, so browsing
  // (or acting on a different entry) isn't blocked by one in-flight call.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  // "Install all" runs across the currently-filtered list rather than the
  // whole catalog, so narrowing with the search box first scopes it -- a
  // separate busy/error pair from the per-row ones above since it isn't
  // tied to any single entry.
  const [installingAll, setInstallingAll] = useState(false);
  const [installAllError, setInstallAllError] = useState<string | null>(null);

  function load() {
    setStatus("loading");
    setError("");
    Promise.all([fetchCatalog(), fetchGramplets()])
      .then(([entries, gramplets]) => {
        setCatalog(entries);
        setInstalled(gramplets);
        setStatus("ready");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }

  useEffect(load, []);

  async function handleInstall(entry: CatalogEntry) {
    if (!canAuthorGramplets()) return;
    setBusyId(entry.id);
    setActionError(null);
    try {
      const built = await installFromCatalog(entry);
      setInstalled((prev) => [...prev, built]);
    } catch (err) {
      setActionError({ id: entry.id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdate(entry: CatalogEntry, gramplet: Gramplet) {
    if (!canAuthorGramplets()) return;
    if (
      wasEditedSinceInstall(gramplet) &&
      !window.confirm(
        `Update "${gramplet.label}"? You've customized this Gramplet's code since installing it -- updating will overwrite your changes with the Store's current version. There is no undo.`
      )
    ) {
      return;
    }
    setBusyId(entry.id);
    setActionError(null);
    try {
      const updated = await updateFromCatalog(gramplet, entry);
      setInstalled((prev) => prev.map((g) => (g.handle === updated.handle ? updated : g)));
    } catch (err) {
      setActionError({ id: entry.id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(entry: CatalogEntry, gramplet: Gramplet) {
    if (!canAuthorGramplets() || !gramplet.handle) return;
    if (!window.confirm(`Delete "${gramplet.label}"? This removes it from the tree entirely. There is no undo.`)) return;
    setBusyId(entry.id);
    setActionError(null);
    try {
      await removeGramplet(gramplet.handle);
      setInstalled((prev) => prev.filter((g) => g.handle !== gramplet.handle));
    } catch (err) {
      setActionError({ id: entry.id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyId(null);
    }
  }

  const visible = catalog.filter((entry) => matches(entry, query.trim()));
  const canAuthor = canAuthorGramplets();
  const pending = visible.filter((entry) => !findInstalledEntry(installed, entry.id));

  async function handleInstallAll() {
    if (!canAuthorGramplets() || pending.length === 0) return;
    setInstallingAll(true);
    setInstallAllError(null);
    const failures: string[] = [];
    for (const entry of pending) {
      try {
        const built = await installFromCatalog(entry);
        setInstalled((prev) => [...prev, built]);
      } catch (err) {
        failures.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures.length > 0) setInstallAllError(failures.join("; "));
    setInstallingAll(false);
  }

  return (
    <Modal opened onClose={onClose} title={t("Gramplet Store")} size="90%">
      {status === "loading" && <Loader size="sm" />}
      {status === "error" && (
        <Alert color="red" title={t("Couldn't load the Gramplet Store")}>
          <Stack gap="sm">
            <Text size="sm">{error}</Text>
            <Group>
              <Button size="xs" onClick={load}>
                {t("Retry")}
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
      {status === "ready" && (
        <Stack gap="sm">
          <Group gap="sm" wrap="nowrap">
            <TextInput
              placeholder={t("Search by name, description, category or author")}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              autoFocus
              style={{ flex: 1 }}
            />
            <Button
              size="sm"
              variant="default"
              onClick={handleInstallAll}
              loading={installingAll}
              disabled={!canAuthor || pending.length === 0}
            >
              {t("Install all")}
            </Button>
          </Group>
          {installAllError && (
            <Alert color="red" title={t("Some Gramplets failed to install")}>
              {installAllError}
            </Alert>
          )}
          {visible.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("No matches")}
            </Text>
          )}
          {visible.map((entry) => {
            const gramplet = findInstalledEntry(installed, entry.id);
            const updateAvailable = gramplet ? hasCatalogUpdate(gramplet, entry) : false;
            const expanded = expandedId === entry.id;
            const busy = busyId === entry.id;
            return (
              <Card key={entry.id} withBorder padding="sm">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Group
                    gap="sm"
                    wrap="nowrap"
                    align="flex-start"
                    style={{ cursor: "pointer", flex: 1, minWidth: 0 }}
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                  >
                    {entry.iconUrl && (
                      <img
                        src={resolveCatalogAssetUrl(DEFAULT_CATALOG_URL, entry.iconUrl)}
                        alt=""
                        width={32}
                        height={32}
                        style={{ borderRadius: 4, flexShrink: 0 }}
                      />
                    )}
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Group gap="xs" wrap="wrap">
                        <Text fw={600}>{entry.name}</Text>
                        <Badge size="xs" variant="light">
                          {entry.category}
                        </Badge>
                        {gramplet && !updateAvailable && (
                          <Badge size="xs" color="green" variant="light">
                            {t("Installed")}
                          </Badge>
                        )}
                        {updateAvailable && (
                          <Badge size="xs" color="orange" variant="light">
                            {t("Update available")}
                          </Badge>
                        )}
                      </Group>
                      <Text size="sm" c="dimmed">
                        {entry.description}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {entry.author} · v{entry.version}
                      </Text>
                    </Stack>
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    {!gramplet && (
                      <Button size="xs" onClick={() => handleInstall(entry)} loading={busy} disabled={!canAuthor}>
                        {t("Install")}
                      </Button>
                    )}
                    {gramplet && updateAvailable && (
                      <Button size="xs" onClick={() => handleUpdate(entry, gramplet)} loading={busy} disabled={!canAuthor}>
                        {t("Update")}
                      </Button>
                    )}
                    {gramplet && (
                      <Button
                        size="xs"
                        variant="default"
                        color="red"
                        onClick={() => handleRemove(entry, gramplet)}
                        loading={busy}
                        disabled={!canAuthor}
                      >
                        {t("Remove")}
                      </Button>
                    )}
                  </Group>
                </Group>
                {actionError?.id === entry.id && (
                  <Alert color="red" mt="xs">
                    {actionError.message}
                  </Alert>
                )}
                <Collapse in={expanded}>
                  <Stack gap="xs" mt="sm">
                    <Text size="sm" fw={500}>
                      {t("Code preview")}
                    </Text>
                    <PythonCodeEditor value={entry.code} onChange={() => {}} minHeight={200} readOnly />
                  </Stack>
                </Collapse>
              </Card>
            );
          })}
        </Stack>
      )}
    </Modal>
  );
}
