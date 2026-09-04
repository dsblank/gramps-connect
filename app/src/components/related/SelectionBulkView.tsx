import { useEffect, useState } from "react";
import { Alert, Anchor, Group, Stack, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchPlainObject } from "../../store/objectsApi";
import { getViewStore } from "../../store/registry";
import type { ViewConfig } from "../../store/views";
import { summaryLine } from "./summary";
import { LINK_STYLE } from "./sections/shared";
import { BulkDeleteButton } from "./BulkDeleteButton";
import { BulkTagButton } from "./BulkTagButton";
import type { OnNavigate } from "./types";
import { t } from "../../i18n/i18n";

/** AsideSplit.tsx's top-pane mount when 3+ rows are ctrl/cmd-click selected:
 * a shared header row with bulk Delete/Tag, above a lightweight list of what
 * each selected handle actually is (via the same fetchPlainObject +
 * summaryLine RelatedPanel's own header uses, not a full RelatedPanel per
 * row -- that wouldn't scale past a couple of panes). Each row is a link
 * (same Anchor/LINK_STYLE treatment as RefRow in sections/shared.tsx) that
 * opens the bottom Reference-detail pane for that one record via
 * `onNavigate` -- with no per-row RelatedPanel here to show the record's
 * own details inline, this is the only way to actually look at one of the
 * N selected objects individually while still in bulk-selection mode. */
export function SelectionBulkView({ view, handles, onNavigate }: { view: ViewConfig; handles: string[]; onNavigate: OnNavigate }) {
  // Keyed by handle and never wholesale-reset -- ctrl+clicking one more (or
  // fewer) row into an already-open bulk selection only needs to fetch the
  // label(s) that just joined, not re-fetch (and blank the list behind a
  // spinner for) every row already showing. Previously this reset to `null`
  // on every selection-membership change, which flashed the whole list to a
  // loading spinner on every single ctrl+click -- jarring for what's really
  // an incremental, near-instant update.
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const missing = handles.filter((h) => !(h in labels));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const entries = await Promise.all(
          missing.map(async (h) => [h, summaryLine(view.key, await fetchPlainObject(token, view, h))] as const)
        );
        if (!cancelled) setLabels((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `labels` deliberately left out of the deps -- reading it here is only
    // to compute `missing` against this render's already-current value, not
    // something this effect should re-run for; including it would just
    // re-fire (harmlessly, since `missing` would then be empty) right after
    // every setLabels this same effect just did. handles.join keys the
    // effect on membership, not array identity -- AsideSplit passes a fresh
    // array from the store snapshot on every selection change, but only a
    // real membership change needs a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, handles.join(",")]);

  return (
    <Stack gap="md" p="md">
      <Group gap="xs" wrap="wrap" justify="flex-end">
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          {handles.length} {t("selected")}
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
        {handles.map((h, i) => {
          const grampsId = getViewStore(view.key).grampsIdForHandle(h);
          return (
            <Group key={h} gap={6} wrap="nowrap">
              <Text size="md" c="dimmed" style={{ flex: "none", textAlign: "right", minWidth: `${String(handles.length).length}ch` }}>
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
                {labels[h] ?? (grampsId ? `[${grampsId}]` : "")}
              </Anchor>
            </Group>
          );
        })}
      </Stack>
    </Stack>
  );
}
