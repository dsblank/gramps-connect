import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Badge, Box, Button, Center, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { getCurrentUsername, getToken } from "../../auth/auth";
import { formatHash, isVisualKey, type VisualKey } from "../../hash";
import { clearActivity, getActivity, getActivityVersion, subscribeActivity, type ActivityEntry } from "../../store/activityLog";
import { fetchOwnEdits, type EditEntry } from "../../store/activityEdits";
import {
  buildSessions, collapseRuns, formatDuration, isHidden, type Session, type TimelineEntry, type TimelineItem, type TimelineRow,
} from "../../store/activityTimeline";
import { fetchRecords, recordLabel } from "../../store/homeStats";
import { ageGroupOf } from "../../store/ageGroups";
import { confirmDialog } from "../../store/confirmDialog";
import { getViewStore } from "../../store/registry";
import { setSearchState } from "../../store/searchState";
import { setFilterPickerState } from "../../store/filterPickerState";
import { openRelationshipWindow } from "../../store/relationshipWindow";
import { VIEWS } from "../../store/views";
import { t } from "../../i18n/i18n";
import { VisualFrame } from "./VisualFrame";
import { presetSearch } from "./SearchView";
import classes from "./ActivityList.module.css";

/** Sessions shown per "Load more": each page fetches the names of the
 * records in it, one request per type. */
const PAGE_SESSIONS = 8;

/** How far back edits are read when the browser log is empty. */
const EDITS_FALLBACK_SECONDS = 30 * 24 * 3600;

const VISUAL_LABELS: Record<VisualKey, string> = {
  map: "Map", timeline: "Timeline", tree: "Graphs", search: "Search all",
  changed: "Change Log", visited: "Visited", bookmarks: "Bookmarks",
};

/** The visuals that plot records, and so can be scoped to one. */
const SCOPED_VISUALS = new Set<string>(["map", "timeline", "tree"]);

type Ref = { type: string; handle: string };
/** A record's label; null once it's known not to exist (deleted, or no
 * longer visible to this user); absent while still being fetched. */
type Labels = Map<string, string | null>;
const keyOf = (r: Ref) => `${r.type}:${r.handle}`;

/** The records an entry names, for fetching their labels. */
function refsOf(entry: TimelineEntry): Ref[] {
  switch (entry.kind) {
    case "route":
      return [
        ...(entry.handle ? [{ type: entry.viewKey, handle: entry.handle }] : []),
        ...(entry.subject ? [entry.subject] : []),
      ];
    case "edit":
      return entry.changes.slice(0, 1);
    case "relationship":
      return [{ type: "person", handle: entry.from }, { type: "person", handle: entry.to }];
    default:
      return [];
  }
}

function viewLabel(key: string): string {
  return t(VIEWS.find((v) => v.key === key)?.label ?? key);
}

function viewIcon(key: string): string | undefined {
  return VIEWS.find((v) => v.key === key)?.icon;
}

function clock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(unix: number): string {
  const group = ageGroupOf(unix);
  if (group === "today") return t("Today");
  if (group === "yesterday") return t("Yesterday");
  return new Date(unix * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Back to the step: the same page, search, filter, window or site. */
async function replay(entry: TimelineEntry): Promise<void> {
  switch (entry.kind) {
    case "route":
      window.location.hash = formatHash({ viewKey: entry.viewKey, handle: entry.handle ?? null, subject: entry.subject ?? null });
      return;
    case "edit": {
      const first = entry.changes[0];
      window.location.hash = formatHash({ viewKey: first.type, handle: first.handle });
      return;
    }
    case "external":
      window.open(entry.url, "_blank", "noopener,noreferrer");
      return;
    case "searchAll":
      presetSearch(entry.query, entry.type);
      window.location.hash = formatHash({ viewKey: "search" });
      return;
    case "search": {
      // Loaded and filtered before the list mounts, so its search box
      // (FilterBar.tsx) comes up showing the search, applied.
      const store = getViewStore(entry.viewKey);
      await store.ensureLoaded();
      setSearchState(entry.viewKey, { input: entry.text, useGoql: entry.useGoql, dirty: false });
      await store.applyWhereExpr(entry.whereExpr);
      window.location.hash = formatHash({ viewKey: entry.viewKey });
      return;
    }
    case "filter": {
      const store = getViewStore(entry.viewKey);
      await store.ensureLoaded();
      setFilterPickerState(entry.viewKey, entry.tree);
      await store.setPickerFilter(entry.whereExpr);
      window.location.hash = formatHash({ viewKey: entry.viewKey });
      return;
    }
    case "relationship":
      openRelationshipWindow(entry.from, entry.to);
      return;
    default:
      return;
  }
}

/** Whether replay() can go back to it at all (records must still exist). */
function canReplay(entry: TimelineEntry, labels: Labels): boolean {
  if (entry.kind === "report" || entry.kind === "gramplet" || entry.kind === "away") return false;
  return refsOf(entry).every((r) => typeof labels.get(keyOf(r)) === "string");
}

interface Described {
  icon?: string;
  badge?: string;
  text: string;
  detail?: string;
}

function describe(entry: TimelineEntry, labels: Labels): Described {
  const name = (r: Ref) => {
    const label = labels.get(keyOf(r));
    return label === undefined ? "…" : label ?? t("(deleted)");
  };
  switch (entry.kind) {
    case "route": {
      if (entry.handle) return { icon: viewIcon(entry.viewKey), text: name({ type: entry.viewKey, handle: entry.handle }) };
      if (isVisualKey(entry.viewKey)) {
        const label = t(VISUAL_LABELS[entry.viewKey]);
        if (!SCOPED_VISUALS.has(entry.viewKey)) return { text: label };
        return { badge: label, text: entry.subject ? name(entry.subject) : t("Whole tree") };
      }
      return { icon: viewIcon(entry.viewKey), text: `${viewLabel(entry.viewKey)} ${t("list")}` };
    }
    case "edit": {
      const first = entry.changes[0];
      const verb = first.op === "added" ? t("Added") : first.op === "deleted" ? t("Deleted") : t("Edited");
      const more = entry.changes.length > 1 ? ` + ${entry.changes.length - 1} ${t("more")}` : "";
      return {
        icon: viewIcon(first.type),
        badge: entry.undo ? t("Undo") : verb,
        text: `${first.op === "deleted" ? viewLabel(first.type) : name(first)}${more}`,
      };
    }
    case "external":
      return { badge: t("Web"), text: entry.site, detail: entry.terms };
    case "search":
      return { badge: t("Search"), text: `“${entry.text}”`, detail: viewLabel(entry.viewKey) };
    case "searchAll":
      return { badge: t("Search"), text: `“${entry.query}”`, detail: entry.type ? viewLabel(entry.type) : t("Search all") };
    case "filter":
      return { badge: t("Filter"), text: entry.summary || t("Filter"), detail: viewLabel(entry.viewKey) };
    case "relationship":
      return {
        badge: t("Relationship"),
        text: `${name({ type: "person", handle: entry.from })} ↔ ${name({ type: "person", handle: entry.to })}`,
      };
    case "report":
      return { badge: t("Report"), text: entry.name, detail: entry.desc !== entry.name ? entry.desc : undefined };
    case "gramplet":
      return { badge: t("Gramplet"), text: entry.name };
    default:
      return { text: "" };
  }
}

/** One line of the page's grid (ActivityList.module.css). */
function GridRow({ nested, at, icon, kind, what, detail, duration }: {
  nested?: boolean;
  at: number;
  icon?: string;
  kind?: string;
  what: ReactNode;
  detail?: string;
  duration?: number;
}) {
  return (
    <div className={nested ? `${classes.grid} ${classes.nested}` : classes.grid}>
      <Text size="sm" c="dimmed" className={classes.time}>{clock(at)}</Text>
      <Box style={{ display: "flex", justifyContent: "center" }}>
        {icon && <img src={icon} alt="" width={18} height={18} />}
      </Box>
      <Box style={{ minWidth: 0 }}>
        {kind && <Badge size="sm" variant="light" tt="none" maw="100%">{kind}</Badge>}
      </Box>
      <Box style={{ minWidth: 0 }}>{what}</Box>
      <Text size="sm" c="dimmed" truncate className={classes.detail}>{detail ?? ""}</Text>
      <Text size="sm" c="dimmed" className={classes.duration}>
        {duration !== undefined && duration >= 30 ? formatDuration(duration) : ""}
      </Text>
    </div>
  );
}

function Row({ item, labels, nested }: { item: TimelineItem; labels: Labels; nested?: boolean }) {
  const { entry, duration } = item;
  const d = describe(entry, labels);
  const clickable = canReplay(entry, labels);
  const body = (
    <GridRow
      nested={nested}
      at={entry.at}
      icon={d.icon}
      kind={d.badge}
      what={<Text size="sm" truncate c={clickable ? undefined : "dimmed"}>{d.text}</Text>}
      detail={d.detail}
      duration={duration}
    />
  );
  if (!clickable) return body;
  return (
    <UnstyledButton
      onClick={() => goBack(entry)}
      className={classes.row}
      title={t("Go back to this step")}
    >
      {body}
    </UnstyledButton>
  );
}

function RunRow({ row, labels, open, onToggle }: {
  row: Extract<TimelineRow, { kind: "run" }>;
  labels: Labels;
  open: boolean;
  onToggle: () => void;
}) {
  const newest = row.items[0].entry;
  const oldest = row.items[row.items.length - 1].entry;
  const total = row.items.reduce((sum, it) => sum + (it.duration ?? 0), 0);
  const toggle = open ? "▾" : "▸";
  let body: ReactNode;
  if (newest.kind === "edit") {
    const first = newest.changes[0];
    body = (
      <GridRow
        at={oldest.at}
        icon={viewIcon(first.type)}
        kind={t("Edited")}
        what={
          <Text size="sm" truncate>
            {labels.has(keyOf(first)) ? labels.get(keyOf(first)) ?? t("(deleted)") : "…"} {toggle}
          </Text>
        }
        detail={`${row.items.length} ${t("changes")}`}
        duration={total}
      />
    );
  } else {
    const viewKey = newest.kind === "route" ? newest.viewKey : "";
    body = (
      <GridRow
        at={oldest.at}
        icon={viewIcon(viewKey)}
        kind={t("Opened")}
        what={<Text size="sm" truncate>{row.items.length} {viewLabel(viewKey)} {toggle}</Text>}
        duration={total}
      />
    );
  }
  return (
    <>
      <UnstyledButton onClick={onToggle} className={classes.row}>{body}</UnstyledButton>
      {open && row.items.map((item, i) => <Row key={i} item={item} labels={labels} nested />)}
    </>
  );
}

function SessionBlock({ session, labels }: { session: Session; labels: Labels }) {
  const [openRuns, setOpenRuns] = useState<Set<number>>(() => new Set());
  const rows = useMemo(() => collapseRuns(session.items), [session]);
  const length = session.end - session.start;
  return (
    <Stack gap={2}>
      <Group gap="xs" mb={4} className={classes.session}>
        <Text size="sm" fw={600}>{dayLabel(session.start)}</Text>
        <Text size="sm" c="dimmed">
          {clock(session.start)}–{clock(session.end)}
          {length >= 60 ? ` · ${formatDuration(length)}` : ""}
          {` · ${session.items.length} ${session.items.length === 1 ? t("step") : t("steps")}`}
        </Text>
      </Group>
      {rows.map((row, i) =>
        row.kind === "item" ? (
          <Row key={i} item={row.item} labels={labels} />
        ) : (
          <RunRow
            key={i}
            row={row}
            labels={labels}
            open={openRuns.has(i)}
            onToggle={() => setOpenRuns((prev) => {
              const next = new Set(prev);
              if (next.has(i)) next.delete(i); else next.add(i);
              return next;
            })}
          />
        ),
      )}
    </Stack>
  );
}

/** The browser's step log, kept current. */
function useActivityLog(): ActivityEntry[] {
  const version = useSyncExternalStore(subscribeActivity, getActivityVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo<ActivityEntry[]>(() => getActivity(), [version]);
}

/** This user's edits since `after` (activityEdits.ts). A failure (most
 * often a Guest, who can't read the history) just means no edits. */
function useOwnEdits(after: number): { edits: EditEntry[]; loading: boolean } {
  const [edits, setEdits] = useState<EditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const username = getCurrentUsername();
    if (!username) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const found = await fetchOwnEdits(await getToken(), username, after - 1);
        if (!cancelled) setEdits(found);
      } catch (err) {
        console.warn("[activity] own edits: fetch failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [after]);
  return { edits, loading };
}

/** Labels for the records `entries` name, fetched as they're first needed
 * (one request per type) and kept. */
function useRecordLabels(entries: TimelineEntry[]): { labels: Labels; error: string | null } {
  const [labels, setLabels] = useState<Labels>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const needed = useMemo(() => {
    const refs = new Map<string, Ref>();
    for (const entry of entries) for (const r of refsOf(entry)) {
      if (!labels.has(keyOf(r))) refs.set(keyOf(r), r);
    }
    return [...refs.values()];
  }, [entries, labels]);
  const neededKey = needed.map(keyOf).join(",");

  useEffect(() => {
    if (needed.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await fetchRecords(await getToken(), needed);
        if (cancelled) return;
        setLabels((prev) => {
          const next = new Map(prev);
          for (const r of needed) {
            const obj = found.get(keyOf(r));
            next.set(keyOf(r), obj ? recordLabel(r.type, obj) : null);
          }
          return next;
        });
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey]);
  return { labels, error };
}

function goBack(entry: TimelineEntry): void {
  replay(entry).catch((err) => console.error("[activity] going back failed", err));
}

/** Opening a record: what Home's Recently visited card already lists. */
function isRecordOpen(entry: TimelineEntry): boolean {
  return entry.kind === "route" && !!entry.handle;
}

/** The Home page's Recent activity card body: the newest `limit` steps
 * other than opening a record (the Recently visited card beside it has
 * those), each a link back to it. Edits are read only as far back as those
 * steps reach (a week when there are none), so the card stays one small
 * read. */
export function RecentActivityRows({ limit, timeAgo }: { limit: number; timeAgo: (unix: number) => string }) {
  const log = useActivityLog();
  const visible = log.filter((e) => !isHidden(e) && !isRecordOpen(e));
  const after = visible.length >= limit
    ? visible[visible.length - limit].at
    : Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  const { edits, loading } = useOwnEdits(after);
  const items = useMemo(
    () => buildSessions(log, edits).flatMap((s) => s.items).map((it) => it.entry)
      .filter((e) => !isRecordOpen(e)).slice(0, limit),
    [log, edits, limit],
  );
  const { labels } = useRecordLabels(items);
  if (items.length === 0) {
    return loading ? null : (
      <Text c="dimmed">{t("Your searches, filters, charts and edits will be listed here.")}</Text>
    );
  }
  return (
    <Stack gap="xs">
      {items.map((entry, i) => {
        const d = describe(entry, labels);
        const clickable = canReplay(entry, labels);
        const row = (
          <Group gap="xs" wrap="nowrap">
            <Box w={20} style={{ flex: "none", display: "flex", justifyContent: "center" }}>
              {d.icon && <img src={d.icon} alt="" width={20} height={20} />}
            </Box>
            {d.badge && <Badge size="sm" variant="light" tt="none" style={{ flex: "none" }}>{d.badge}</Badge>}
            <Text truncate style={{ flex: 1, minWidth: 0 }} c={clickable ? undefined : "dimmed"}>{d.text}</Text>
            <Text size="xs" c="dimmed" style={{ flex: "none" }}>{timeAgo(entry.at)}</Text>
          </Group>
        );
        return clickable ? (
          <UnstyledButton key={i} onClick={() => goBack(entry)} title={t("Go back to this step")}>{row}</UnstyledButton>
        ) : (
          <Box key={i}>{row}</Box>
        );
      })}
    </Stack>
  );
}

/** View > Visited's Activity tab: every step of this user's research,
 * grouped into sittings, newest first, each a link back to that step. The
 * steps are kept in this browser (store/activityLog.ts); the user's own
 * edits come from the server's history (store/activityEdits.ts). */
export function ActivityView({ modeSwitch }: { modeSwitch: ReactNode }) {
  const log = useActivityLog();
  const [limit, setLimit] = useState(PAGE_SESSIONS);
  const oldestAt = log.length > 0 ? log[0].at : Math.floor(Date.now() / 1000) - EDITS_FALLBACK_SECONDS;
  const { edits, loading: editsLoading } = useOwnEdits(oldestAt);
  const sessions = useMemo(() => buildSessions(log, edits), [log, edits]);
  const shown = useMemo(() => sessions.slice(0, limit), [sessions, limit]);
  const shownEntries = useMemo(() => shown.flatMap((s) => s.items.map((it) => it.entry)), [shown]);
  const { labels, error } = useRecordLabels(shownEntries);

  async function handleClear() {
    const ok = await confirmDialog(
      t("Clear your research activity? This only affects this browser; your edits stay in the tree's history."),
      t("Clear"),
    );
    if (ok) clearActivity();
  }

  const empty =
    sessions.length === 0 && !editsLoading ? (
      <Stack gap={4} align="center" maw={420}>
        <Text size="sm" c="dimmed" ta="center">
          {t("Every step of your research will be listed here: records and charts you open, searches, filters, external sites, reports and your edits.")}
        </Text>
        <Text size="xs" c="dimmed" ta="center">{t("Kept in this browser only; your edits come from the tree's history.")}</Text>
      </Stack>
    ) : undefined;

  return (
    <VisualFrame
      title={t("Visited")}
      loading={editsLoading && sessions.length === 0}
      loadingText={t("Loading activity…")}
      error={error}
      empty={empty}
      toolbar={
        <Group justify="space-between">
          {modeSwitch}
          <Button size="xs" variant="default" onClick={handleClear} disabled={log.length === 0}>
            {t("Clear activity")}
          </Button>
        </Group>
      }
      status={
        sessions.length > 0 ? (
          <Text size="xs" c="dimmed">
            {sessions.length.toLocaleString()} {t("sessions · click a step to go back to it")}
          </Text>
        ) : undefined
      }
    >
      <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Stack gap="xl" maw={1320} ml="5%" p="md">
          {shown.map((session) => (
            <SessionBlock key={`${session.start}`} session={session} labels={labels} />
          ))}
          {sessions.length > limit && (
            <Center>
              <Button variant="default" onClick={() => setLimit((n) => n + PAGE_SESSIONS)}>
                {t("Load more")}
              </Button>
            </Center>
          )}
        </Stack>
      </Box>
    </VisualFrame>
  );
}
