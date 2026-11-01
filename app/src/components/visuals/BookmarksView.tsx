import { useEffect, useState, useSyncExternalStore } from "react";
import { ActionIcon, Box, Group, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken } from "../../auth/auth";
import {
  BOOKMARKABLE_TYPES, canEditBookmarks, getBookmarks, getBookmarksVersion, loadBookmarks, setBookmarked,
  subscribeBookmarks,
} from "../../store/bookmarks";
import { fetchObjectsByHandle, type RawRecord } from "../../store/objectsByHandle";
import type { SearchHit } from "../../store/searchApi";
import { VIEWS } from "../../store/views";
import { t } from "../../i18n/i18n";
import { VisualFrame } from "./VisualFrame";
import { ObjectResultCard, TypeTabs } from "./ObjectResultList";
import { DateTimeColumn } from "./LatestChangeColumns";

/** The type tab last picked, kept across visits like the other pages'. */
let lastType: string | null = null;

const keyOf = (type: string, handle: string) => `${type}:${handle}`;

/** Removes a bookmark from its card. Needs EditObject, like the star. */
function RemoveBookmarkButton({ type, handle }: { type: string; handle: string }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await setBookmarked(await getToken(), type, handle, false);
    } catch (err: any) {
      notifications.show({ color: "red", title: t("Couldn't remove the bookmark"), message: err?.message ?? String(err) });
      setBusy(false);
    }
  }
  return (
    <Tooltip label={t("Remove bookmark")} withArrow>
      <ActionIcon variant="subtle" color="yellow" onClick={remove} loading={busy} aria-label={t("Remove bookmark")}>
        <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor"
          strokeWidth={1.8} strokeLinejoin="round">
          <polygon points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.7 12 17.6 6.2 20.7 7.3 14.2 2.6 9.6 9.1 8.7" />
        </svg>
      </ActionIcon>
    </Tooltip>
  );
}

/** View > Bookmarks: the tree's bookmarks, one section per kind of record
 * (People, Families, ...) in the order each was added -- Gramps' own
 * bookmarks, so the same list everyone on the tree and Gramps desktop see.
 * The list is reloaded each time the page opens (another user may have
 * changed it) and the records fetched fresh. A bookmark whose record no
 * longer exists is left out here but not deleted: the list is shared, and
 * that's not this page's call. */
export function BookmarksView() {
  useSyncExternalStore(subscribeBookmarks, getBookmarksVersion);
  const [typeFilter, setTypeFilter] = useState<string | null>(lastType);
  const [listsReady, setListsReady] = useState(false);
  const [records, setRecords] = useState<Map<string, RawRecord | null>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getToken()
      .then((token) => loadBookmarks(token, true))
      .then(
        () => { if (!cancelled) setListsReady(true); },
        (err) => { if (!cancelled) setError(err?.message ?? String(err)); },
      );
    return () => { cancelled = true; };
  }, []);

  const types = typeFilter ? [typeFilter] : BOOKMARKABLE_TYPES;
  const sections = listsReady ? types.map((type) => ({ type, handles: getBookmarks(type) })) : [];
  const needed = sections.flatMap(({ type, handles }) =>
    handles.filter((h) => !records.has(keyOf(type, h))).map((handle) => ({ type, handle })));
  const neededKey = needed.map((n) => keyOf(n.type, n.handle)).join(",");

  useEffect(() => {
    if (needed.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const byType = new Map<string, string[]>();
        for (const n of needed) byType.set(n.type, [...(byType.get(n.type) ?? []), n.handle]);
        const fetched = await Promise.all(
          [...byType].map(async ([type, handles]) => ({ type, handles, found: await fetchObjectsByHandle(token, type, handles) })),
        );
        if (cancelled) return;
        setRecords((prev) => {
          const next = new Map(prev);
          for (const { type, handles, found } of fetched) {
            for (const handle of handles) next.set(keyOf(type, handle), found.get(handle) ?? null);
          }
          return next;
        });
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey]);

  function selectType(type: string | null) {
    lastType = type;
    setTypeFilter(type);
  }

  const editable = canEditBookmarks();
  const shownSections = sections
    .map(({ type, handles }) => ({
      type,
      items: handles
        .map((handle) => ({ handle, record: records.get(keyOf(type, handle)) }))
        .filter((x): x is { handle: string; record: RawRecord } => !!x.record),
    }))
    .filter((section) => section.items.length > 0);
  const total = shownSections.reduce((n, s) => n + s.items.length, 0);
  const missing = sections.reduce(
    (n, { type, handles }) => n + handles.filter((h) => records.get(keyOf(type, h)) === null).length, 0);
  const stillLoading = !listsReady || (needed.length > 0 && total === 0);

  const empty =
    !stillLoading && total === 0 ? (
      <Stack gap={4} align="center" maw={440}>
        <Text size="sm" c="dimmed" ta="center">
          {missing > 0
            ? t("Every bookmark here points to a record that no longer exists.")
            : typeFilter ? t("No bookmarks of this kind yet.") : t("This tree has no bookmarks yet.")}
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          {editable
            ? t("Click the star next to a record's name to bookmark it.")
            : t("Bookmarks are added with the star next to a record's name, by anyone who can edit the tree.")}
        </Text>
      </Stack>
    ) : undefined;

  return (
    <VisualFrame
      title={t("Bookmarks")}
      loading={stillLoading && !error}
      loadingText={t("Loading bookmarks…")}
      error={error}
      empty={empty}
      scope={<TypeTabs active={typeFilter} onSelect={selectType} types={BOOKMARKABLE_TYPES} />}
      status={
        total > 0 ? (
          <Text size="xs" c="dimmed">
            {total.toLocaleString()} {t("bookmarks, shared by everyone working on this tree")}
            {missing > 0 && ` · ${missing.toLocaleString()} ${t("point to records that no longer exist")}`}
          </Text>
        ) : undefined
      }
    >
      <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Stack gap="xl" maw={1320} ml="5%" p="md">
          {shownSections.map(({ type, items }) => (
            <Stack key={type} gap="lg">
              {/* Section headings only when several kinds are shown. */}
              {!typeFilter && (
                <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                  {t(VIEWS.find((v) => v.key === type)?.label ?? type)}
                </Text>
              )}
              {items.map(({ handle, record }) => {
                const hit: SearchHit = { handle, object_type: type, object: record, score: null };
                return (
                  <ObjectResultCard
                    key={keyOf(type, handle)}
                    hit={hit}
                    aside={
                      <Group gap="xl" align="flex-start" wrap="nowrap" style={{ flex: "none" }}>
                        <DateTimeColumn label={t("Last changed")} unix={Number(record.change ?? 0)} />
                        {editable && <RemoveBookmarkButton type={type} handle={handle} />}
                      </Group>
                    }
                  />
                );
              })}
            </Stack>
          ))}
        </Stack>
      </Box>
    </VisualFrame>
  );
}
