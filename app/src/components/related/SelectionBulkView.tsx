import { useEffect, useState } from "react";
import { Alert, Anchor, Group, Stack, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchPlainObject } from "../../store/objectsApi";
import { getViewStore } from "../../store/registry";
import type { ViewConfig } from "../../store/views";
import { summaryLine, withGrampsId } from "./summary";
import { pickerResultLabel } from "../RefPickerField";
import { LINK_STYLE } from "./sections/shared";
import { BulkDeleteButton } from "./BulkDeleteButton";
import { BulkTagButton } from "./BulkTagButton";
import type { OnNavigate } from "./types";
import { t } from "../../i18n/i18n";

/** How many selected records the list names. A Ctrl/Cmd+A or long
 * shift+click range can select tens of thousands -- past this the rest are
 * just counted ("…and 4,900 more"); the table beside this pane already
 * shows them all. */
const LISTED_LIMIT = 100;

/** Types whose label comes straight from the list's own cached row
 * (pickerResultLabel(), the label every record picker shows for a /query/
 * row) -- no request at all. The rest (Generated, Stories, Discussions,
 * Blog) still fetch each record for summaryLine(). */
const CACHED_LABEL_TYPES = new Set(["person", "family", "event", "place", "repository", "source", "citation", "media", "note", "tag"]);

/** AsideSplit.tsx's top-pane mount when 3+ rows are selected: a shared
 * header row with bulk Delete/Tag, above a lightweight list of what each
 * selected handle actually is, not a full RelatedPanel per row -- that
 * wouldn't scale past a couple of panes. Labels come from the local cache
 * the table itself reads, so they're there on the first render; only the
 * few types whose list columns can't make one (CACHED_LABEL_TYPES) fetch,
 * each label showing as soon as its own request returns. Each row is a
 * link (same Anchor/LINK_STYLE treatment as RefRow in sections/shared.tsx)
 * that opens the bottom Reference-detail pane for that one record via
 * `onNavigate` -- with no per-row RelatedPanel here to show the record's
 * own details inline, this is the only way to actually look at one of the
 * N selected objects individually while still in bulk-selection mode. */
/** A cached column's text the way the table's own cell shows it (that
 * column's toDisplay), or "" when it renders to nothing textual. */
function cellText(view: ViewConfig, key: string, item: Record<string, unknown>): string {
  const column = view.columns.find((c) => c.key === key);
  const value = column?.toDisplay ? column.toDisplay(item[key], (k) => item[k]) : item[key];
  return typeof value === "string" ? value : "";
}

/** A cached row's label: pickerResultLabel(), except for the types where
 * that would read differently from the record's own header
 * (summaryLine()): places show their title as the table's Title cell does
 * (the tree's place format), and events show "Type: date" rather than
 * "Type: description". Exported for its test. */
export function cachedLabel(view: ViewConfig, item: Record<string, unknown> & { handle: string }): string {
  const id = item.gramps_id as string | undefined;
  if (view.key === "place") {
    return withGrampsId(id, cellText(view, "title", item) || "(untitled)");
  }
  if (view.key === "event") {
    const text = [cellText(view, "event_type", item), cellText(view, "date", item)].filter(Boolean).join(": ");
    return withGrampsId(id, text || (item.description as string | undefined) || "(event)");
  }
  return pickerResultLabel(view.key, item);
}

export function SelectionBulkView({ view, handles, onNavigate }: { view: ViewConfig; handles: string[]; onNavigate: OnNavigate }) {
  // Fetched labels, for types not in CACHED_LABEL_TYPES. Keyed by handle
  // and never wholesale-reset -- ctrl+clicking one more (or fewer) row into
  // an already-open bulk selection only needs to fetch the label(s) that
  // just joined, not re-fetch every row already showing.
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const listed = handles.slice(0, LISTED_LIMIT);
  const fromCache = CACHED_LABEL_TYPES.has(view.key);
  // Read on every render rather than memoized: one indexed query for at
  // most LISTED_LIMIT rows, and it picks up a live-synced edit to a listed
  // record whenever AsideSplit re-renders this pane.
  const cachedItems = fromCache ? getViewStore(view.key).readItemsByHandles(listed) : null;

  useEffect(() => {
    if (fromCache) return;
    setError(null);
    const missing = listed.filter((h) => !(h in labels));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      // Each label lands as soon as its own request returns, and one
      // failed lookup leaves just that row on its Gramps ID rather than
      // blanking every other name with it.
      await Promise.all(
        missing.map(async (h) => {
          try {
            const label = summaryLine(view.key, await fetchPlainObject(token, view, h));
            if (!cancelled) setLabels((prev) => ({ ...prev, [h]: label }));
          } catch (err: any) {
            if (!cancelled) setError(err.message ?? String(err));
          }
        })
      );
    })();
    return () => {
      cancelled = true;
    };
    // `labels` deliberately left out of the deps -- reading it here is only
    // to compute `missing` against this render's already-current value, not
    // something this effect should re-run for; including it would re-fire
    // after every setLabels this same effect just did. listed.join keys the
    // effect on membership, not array identity -- AsideSplit passes a fresh
    // array from the store snapshot on every selection change, but only a
    // real membership change needs a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fromCache, listed.join(",")]);

  return (
    <Stack gap="md" p="md">
      <Group gap="xs" wrap="wrap" justify="flex-end">
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          {handles.length.toLocaleString()} {t("selected")}
        </Text>
        <BulkDeleteButton view={view} handles={handles} />
        <BulkTagButton view={view} handles={handles} />
      </Group>
      {error && (
        <Alert color="red" title={t("Failed to load")}>
          {error}
        </Alert>
      )}
      <Stack gap={4}>
        {listed.map((h, i) => {
          const grampsId = getViewStore(view.key).grampsIdForHandle(h);
          return (
            <Group key={h} gap={6} wrap="nowrap">
              <Text size="md" c="dimmed" style={{ flex: "none", textAlign: "right", minWidth: `${String(listed.length).length}ch` }}>
                {i + 1}.
              </Text>
              <Anchor
                component="button"
                type="button"
                size="md"
                underline="hover"
                style={{ ...LINK_STYLE, flex: 1, minWidth: 0 }}
                truncate
                onClick={() => onNavigate(view.key, h)}
              >
                {(cachedItems?.has(h) ? cachedLabel(view, cachedItems.get(h)!) : labels[h]) ?? (grampsId ? `[${grampsId}]` : "")}
              </Anchor>
            </Group>
          );
        })}
        {handles.length > listed.length && (
          <Text size="sm" c="dimmed">
            {t("…and %s more").replace("%s", (handles.length - listed.length).toLocaleString())}
          </Text>
        )}
      </Stack>
    </Stack>
  );
}
