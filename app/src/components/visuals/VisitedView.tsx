import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Button, Center, Group, Stack, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import {
  clearVisits, forgetVisits, getVisits, getVisitsVersion, subscribeVisits, type Visit,
} from "../../store/visitedHistory";
import { fetchObjectsByHandle, type RawRecord } from "../../store/objectsByHandle";
import { AGE_GROUP_LABELS, groupByAge } from "../../store/ageGroups";
import { confirmDialog } from "../../store/confirmDialog";
import type { SearchHit } from "../../store/searchApi";
import { t } from "../../i18n/i18n";
import { VisualFrame } from "./VisualFrame";
import { ObjectResultCard, TypeTabs } from "./ObjectResultList";
import { DateTimeColumn } from "./LatestChangeColumns";

/** Visits shown per "Load more" -- each page is one request per type
 * among them (objectsByHandle.ts), plus the cards' own thumbnails. */
const PAGE_SIZE = 20;

/** The type tab last picked, kept across visits like Change Log's. */
let lastType: string | null = null;

const keyOf = (v: { type: string; handle: string }) => `${v.type}:${v.handle}`;

/** View > Visited: the records this user has opened from a table, most
 * recent first, grouped Today / Yesterday / ... by when they were opened.
 * The list itself is kept in this browser (store/visitedHistory.ts); the
 * records are fetched fresh from the server a page at a time, so each card
 * shows the record as it is now. A record that's gone (deleted, or no
 * longer visible to this user) drops out of the list. */
export function VisitedView() {
  const version = useSyncExternalStore(subscribeVisits, getVisitsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visits = useMemo(() => getVisits(), [version]);
  const [typeFilter, setTypeFilter] = useState<string | null>(lastType);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [records, setRecords] = useState<Map<string, RawRecord>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = typeFilter ? visits.filter((v) => v.type === typeFilter) : visits;
  const shown = filtered.slice(0, limit);
  const needed = shown.filter((v) => !records.has(keyOf(v)));
  const neededKey = needed.map(keyOf).join(",");

  useEffect(() => {
    if (needed.length === 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const byType = new Map<string, string[]>();
        for (const v of needed) byType.set(v.type, [...(byType.get(v.type) ?? []), v.handle]);
        const fetched = await Promise.all(
          [...byType].map(async ([type, handles]) => ({ type, handles, found: await fetchObjectsByHandle(token, type, handles) })),
        );
        if (cancelled) return;
        const next = new Map(records);
        const gone: Visit[] = [];
        for (const { type, handles, found } of fetched) {
          for (const handle of handles) {
            const record = found.get(handle);
            if (record) next.set(`${type}:${handle}`, record);
            else gone.push({ type, handle, at: 0 });
          }
        }
        setRecords(next);
        setError(null);
        // Only after a successful fetch: a failed one says nothing about
        // whether the record still exists.
        forgetVisits(gone);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey]);

  function selectType(type: string | null) {
    lastType = type;
    setTypeFilter(type);
    setLimit(PAGE_SIZE);
  }

  async function handleClear() {
    const ok = await confirmDialog(
      t("Clear the list of records you've visited? This only affects this browser."),
      t("Clear"),
    );
    if (ok) clearVisits();
  }

  const ready = shown
    .map((visit) => ({ visit, record: records.get(keyOf(visit)) }))
    .filter((x): x is { visit: Visit; record: RawRecord } => !!x.record);
  const groups = groupByAge(ready, (x) => x.visit.at);
  const hasMore = filtered.length > limit;
  const firstLoad = loading && ready.length === 0;

  const empty =
    visits.length === 0 ? (
      <Stack gap={4} align="center" maw={420}>
        <Text size="sm" c="dimmed" ta="center">{t("Records you open will be listed here, most recent first.")}</Text>
        <Text size="xs" c="dimmed" ta="center">{t("The list is kept in this browser only.")}</Text>
      </Stack>
    ) : filtered.length === 0 ? (
      <Text size="sm" c="dimmed" ta="center">{t("You haven't visited any of these yet.")}</Text>
    ) : undefined;

  return (
    <VisualFrame
      title={t("Visited")}
      loading={firstLoad}
      loadingText={t("Loading visited records…")}
      error={error}
      empty={empty}
      scope={<TypeTabs active={typeFilter} onSelect={selectType} />}
      toolbar={
        <Group justify="flex-end">
          <Button size="xs" variant="default" onClick={handleClear} disabled={visits.length === 0}>
            {t("Clear history")}
          </Button>
        </Group>
      }
      status={
        visits.length > 0 ? (
          <Text size="xs" c="dimmed">
            {filtered.length.toLocaleString()} {t("visited, kept in this browser only")}
          </Text>
        ) : undefined
      }
    >
      <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {/* Same wide column as Change Log: dates to the right of each card. */}
        <Stack gap="xl" maw={1320} ml="5%" p="md">
          {groups.map((group) => (
            <Stack key={group.key} gap="lg">
              <Text size="sm" fw={600} c="dimmed" tt="uppercase">{t(AGE_GROUP_LABELS[group.key])}</Text>
              {group.items.map(({ visit, record }) => {
                const hit: SearchHit = { handle: visit.handle, object_type: visit.type, object: record, score: null };
                return (
                  <ObjectResultCard
                    key={keyOf(visit)}
                    hit={hit}
                    aside={
                      <Group gap="xl" align="flex-start" wrap="nowrap" style={{ flex: "none" }}>
                        <DateTimeColumn label={t("Visited")} unix={visit.at} />
                        <DateTimeColumn label={t("Last changed")} unix={Number(record.change ?? 0)} />
                      </Group>
                    }
                  />
                );
              })}
            </Stack>
          ))}
          {hasMore && (
            <Center>
              <Button variant="default" onClick={() => setLimit((n) => n + PAGE_SIZE)} loading={loading}>
                {t("Load more")}
              </Button>
            </Center>
          )}
        </Stack>
      </Box>
    </VisualFrame>
  );
}
