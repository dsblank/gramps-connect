import { useEffect, useState, useSyncExternalStore } from "react";
import { Avatar, Badge, Box, Group, Stack, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchObjectHistory, VIEW_KEY_TO_OBJ_CLASS, type ObjectChange } from "../../store/historyApi";
import { diffObjects, summarizeDiffPaths } from "../../store/historyDiff";
import { formatChange } from "../../store/views";
import { colorForUsername, initialsFor } from "../../store/userAvatar";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../../store/userDirectory";
import type { SearchHit } from "../../store/searchApi";
import { t } from "../../i18n/i18n";

/** What a record's newest history entry says: who, which kind of change,
 * which fields, and how many changes it has had in all. */
interface LatestChange {
  username: string | null;
  /** Sent alongside the username; used when the user directory can't
   * name them (it isn't readable by everyone). */
  fullName: string | null;
  transType: number;
  fields: string;
  count: number;
}

/** "none" = the record has no recorded history (changed before the server
 * kept any, or only ever by Gramps desktop on the same database). */
type Loaded = LatestChange | "none" | "error";

/** Keyed by type, handle and the record's own `change`, so coming Back to
 * View > Change Log doesn't refetch every row, but a record changed again
 * since gets looked up afresh. In memory only, like the page's own state. */
const cache = new Map<string, Loaded>();

async function fetchLatestChange(objClass: string, handle: string): Promise<Loaded> {
  const token = await getToken();
  const { changes, count } = await fetchObjectHistory(token, objClass, handle, { page: 1, pagesize: 1 });
  const change: ObjectChange | undefined = changes[0];
  if (!change) return "none";
  return {
    username: change.connection?.user?.name ?? null,
    fullName: change.connection?.user?.full_name ?? null,
    transType: change.trans_type,
    // Only for an update: an add's "diff" is every field at once, which
    // says nothing the Added badge doesn't (same rule as HistoryButton).
    fields: change.trans_type === 1 ? summarizeDiffPaths(diffObjects(change.old_data, change.new_data)) : "",
    count,
  };
}

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

function nameFor(username: string, fullName: string | null): string {
  const resolved = displayName(username);
  return resolved === username && fullName ? fullName : resolved;
}

function ColumnLabel({ children }: { children: string }) {
  return <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{children}</Text>;
}

/** One labeled date column: the date, then the time and how long ago.
 * Shared with View > Visited's Visited / Last changed columns. */
export function DateTimeColumn({ label, unix }: { label: string; unix: number }) {
  const date = unix ? new Date(unix * 1000) : null;
  return (
    <Stack gap={2} w={170}>
      <ColumnLabel>{label}</ColumnLabel>
      {date && (
        <>
          <Text size="sm">{date.toLocaleDateString(undefined, { dateStyle: "medium" })}</Text>
          <Text size="xs" c="dimmed">
            {date.toLocaleTimeString(undefined, { timeStyle: "short" })} · {formatChange(unix)}
          </Text>
        </>
      )}
    </Stack>
  );
}

/** View > Change Log's right-hand columns for one record: When (full date and
 * time, plus how long ago), Who (from the record's newest history entry),
 * and What (Added/Updated, which fields, how many changes in all). The
 * history lookup is one small request per row, made as the row appears --
 * the same per-row cost as the result cards' thumbnails. */
export function LatestChangeColumns({ hit }: { hit: SearchHit }) {
  // displayName() resolves once the user directory finishes loading.
  useSyncExternalStore(subscribeUserDirectory, getUserDirectoryVersion);
  const objClass = VIEW_KEY_TO_OBJ_CLASS[hit.object_type];
  const changeUnix = Number(hit.object.change ?? 0);
  const key = `${hit.object_type}:${hit.handle}:${changeUnix}`;
  const [loaded, setLoaded] = useState<Loaded | undefined>(() => cache.get(key));

  useEffect(() => {
    if (!objClass) return;
    const cached = cache.get(key);
    if (cached) {
      setLoaded(cached);
      return;
    }
    let cancelled = false;
    fetchLatestChange(objClass, hit.handle).then(
      (result) => {
        cache.set(key, result);
        if (!cancelled) setLoaded(result);
      },
      // Not cached: a rate-limit hiccup shouldn't stick for the session.
      () => { if (!cancelled) setLoaded("error"); },
    );
    return () => { cancelled = true; };
  }, [objClass, hit.handle, key]);

  const latest = loaded && typeof loaded === "object" ? loaded : null;
  const who = latest?.username ? nameFor(latest.username, latest.fullName) : null;

  return (
    <Group gap="xl" align="flex-start" wrap="nowrap" style={{ flex: "none" }}>
      <DateTimeColumn label={t("When")} unix={changeUnix} />
      <Stack gap={2} w={170}>
        <ColumnLabel>{t("Who")}</ColumnLabel>
        {latest ? (
          <Group gap="xs" wrap="nowrap">
            <Avatar
              radius="xl"
              size="sm"
              color={latest.username ? colorForUsername(latest.username) : undefined}
              variant="filled"
            >
              {who ? initialsFor(who) : "?"}
            </Avatar>
            <Text size="sm" truncate>
              {who ?? t("Unknown user")}
            </Text>
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            {loaded === "none" ? t("Not recorded") : loaded === "error" ? "—" : "…"}
          </Text>
        )}
      </Stack>
      <Stack gap={4} w={220}>
        <ColumnLabel>{t("What")}</ColumnLabel>
        {latest ? (
          <>
            <Group gap={6} wrap="nowrap">
              <Badge size="sm" variant="light" color={transTypeColor(latest.transType)}>
                {transTypeLabel(latest.transType)}
              </Badge>
              {latest.count > 1 && (
                <Text size="xs" c="dimmed">
                  {latest.count.toLocaleString()} {t("changes in all")}
                </Text>
              )}
            </Group>
            {latest.fields && (
              <Box>
                <Text size="xs" c="dimmed" ff="monospace" truncate title={latest.fields}>
                  {latest.fields}
                </Text>
              </Box>
            )}
          </>
        ) : (
          <Text size="sm" c="dimmed">{loaded === undefined ? "…" : "—"}</Text>
        )}
      </Stack>
    </Group>
  );
}
