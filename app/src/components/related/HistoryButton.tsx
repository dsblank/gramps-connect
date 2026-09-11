import { useState, useSyncExternalStore } from "react";
import { Avatar, Badge, Button, Group, Loader, Modal, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchObjectHistory, objClassFor, type ObjectChange } from "../../store/historyApi";
import { diffObjects, summarizeDiffPaths, type DiffRow } from "../../store/historyDiff";
import { formatChange, formatChangeTitle } from "../../store/views";
import { colorForUsername, initialsFor } from "../../store/userAvatar";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../../store/userDirectory";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";
import { ViewButton } from "./ViewButton";
import { t } from "../../i18n/i18n";

const PAGE_SIZE = 10;

function transTypeLabel(transType: number): string {
  if (transType === 0) return t("Added");
  if (transType === 2) return t("Deleted");
  return t("Updated");
}

function transTypeColor(transType: number): string {
  if (transType === 0) return "green";
  if (transType === 2) return "red";
  return "blue";
}

/** JSON-stringifies a non-primitive leaf value (diffObjects falls back to a
 * single whole-value row when a path's shape changed type, e.g. an object
 * replaced outright rather than edited field-by-field) so the diff dialog
 * never shows the unreadable default `String()` coercion of an object
 * (`"[object Object]"`). */
function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return t("(none)");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** "View history" button + its two dialogs, shown on RelatedPanel beside
 * VisualButtons -- a way of *looking at* the record (who changed it, when),
 * not an action on it, so it lives in that row rather than the header's
 * action Group with DeleteButton/EditButton.
 *
 * Self-gated on objClassFor(view): renders nothing for app-level constructs
 * layered on Note/Media (Topics, Story, Generated items) that aren't plain
 * edited records -- see historyApi.ts's VIEW_KEY_TO_OBJ_CLASS doc comment.
 * No permission check beyond that: gramps-web-api's object-history endpoint
 * requires only PERM_VIEW_PRIVATE, the same base permission RelatedPanel
 * already assumes to be showing this record's data at all.
 *
 * Two-step reveal, not an inline expanded diff per row: the list shows
 * who/when/what-type for a bounded page of changes, and clicking a row
 * opens a second Modal with the actual field-level before/after -- the same
 * drill-down shape used elsewhere in this app (a click always promotes to
 * more detail, the list itself stays compact). Undo is not offered here --
 * see this repo's wiki (Data-Model-and-Editing.md) for why. */
export function HistoryButton({ view, detail }: { view: ViewConfig; detail: ObjectDetail }) {
  const objClass = objClassFor(view);
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState<ObjectChange[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ObjectChange | null>(null);

  // Re-renders once the background user-directory load resolves, same as
  // ChatBubble.tsx -- displayName() below would otherwise be stuck showing
  // the raw username for entries rendered before it finishes.
  useSyncExternalStore(subscribeUserDirectory, getUserDirectoryVersion);

  if (!objClass) return null;

  async function loadPage(nextPage: number) {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const result = await fetchObjectHistory(token, objClass as string, detail.handle, {
        page: nextPage,
        pagesize: PAGE_SIZE,
      });
      setChanges((prev) => (nextPage === 1 ? result.changes : [...prev, ...result.changes]));
      setCount(result.count);
      setPage(nextPage);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  function openHistory() {
    setOpen(true);
    setChanges([]);
    setCount(0);
    setSelected(null);
    loadPage(1);
  }

  return (
    <>
      {/* A Group, not a bare ViewButton -- RelatedPanel's Stack around this
          row defaults to align="stretch", which would otherwise stretch a
          direct button child to the pane's full width (see the Topic
          "View" button's own comment for the same fix). */}
      <Group gap="xs">
        <ViewButton label={t("History")} onClick={openHistory} color="gray" />
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title={t("History")} size="lg">
        <Stack gap="xs">
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          {changes.length === 0 && !loading && !error && (
            <Text size="sm" c="dimmed">
              {t("No changes recorded yet.")}
            </Text>
          )}
          <ScrollArea.Autosize mah={420}>
            <Stack gap={4}>
              {changes.map((change) => {
                const username = change.connection?.user?.name ?? null;
                // Only for updates -- an add/delete's diff is every field
                // at once (trans_type 0/2 in diffObjects' doc comment), so
                // a path preview there would just dump the whole object's
                // field list rather than hint at anything specific; the
                // Added/Deleted badge already says what happened.
                const pathSummary =
                  change.trans_type === 1 ? summarizeDiffPaths(diffObjects(change.old_data, change.new_data)) : "";
                return (
                  <UnstyledButton
                    key={change.id}
                    onClick={() => setSelected(change)}
                    p="xs"
                    style={{ borderRadius: 4 }}
                  >
                    <Group gap="sm" wrap="nowrap">
                      <Avatar
                        radius="xl"
                        size="sm"
                        color={username ? colorForUsername(username) : undefined}
                        variant="filled"
                      >
                        {username ? initialsFor(displayName(username)) : "?"}
                      </Avatar>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" truncate>
                          {username ? displayName(username) : t("Unknown user")}
                        </Text>
                        <Text size="xs" c="dimmed" title={formatChangeTitle(change.timestamp)}>
                          {formatChange(change.timestamp)}
                        </Text>
                        {pathSummary && (
                          <Text size="xs" c="dimmed" ff="monospace" truncate title={pathSummary}>
                            {pathSummary}
                          </Text>
                        )}
                      </div>
                      <Badge variant="light" color={transTypeColor(change.trans_type)}>
                        {transTypeLabel(change.trans_type)}
                      </Badge>
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
          <Group justify="space-between" wrap="nowrap">
            {loading ? <Loader size="xs" /> : <div />}
            {changes.length < count && (
              <Button variant="subtle" size="xs" onClick={() => loadPage(page + 1)} loading={loading}>
                {t("Load more")}
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
      <HistoryDiffModal change={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function HistoryDiffModal({ change, onClose }: { change: ObjectChange | null; onClose: () => void }) {
  const rows: DiffRow[] = change ? diffObjects(change.old_data, change.new_data) : [];
  return (
    <Modal opened={!!change} onClose={onClose} title={t("What changed")} size="lg">
      {change && (
        <Stack gap="xs">
          {change.trans_type === 0 && (
            <Text size="sm" c="dimmed">
              {t("Record created.")}
            </Text>
          )}
          {change.trans_type === 2 && (
            <Text size="sm" c="dimmed">
              {t("Record deleted.")}
            </Text>
          )}
          {rows.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("No field changes recorded.")}
            </Text>
          ) : (
            <ScrollArea.Autosize mah={420}>
              <Stack gap={6}>
                {rows.map((row) => (
                  <div key={row.path}>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {row.path}
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" c="red" td="line-through" style={{ wordBreak: "break-word" }}>
                        {formatDiffValue(row.before)}
                      </Text>
                      <Text size="sm">{"→"}</Text>
                      <Text size="sm" c="teal" style={{ wordBreak: "break-word" }}>
                        {formatDiffValue(row.after)}
                      </Text>
                    </Group>
                  </div>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Stack>
      )}
    </Modal>
  );
}
