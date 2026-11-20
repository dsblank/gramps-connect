import { useState } from "react";
import { ActionIcon, Button, CloseButton, Group, Text, Title, Tooltip } from "@mantine/core";
import { gqlFilterPresets, namespaceForViewKey, type GqlFilterPreset } from "../data/gqlFilterPresets";
import { customRuleAsPreset, getCachedCustomRules } from "../store/customRuleMedia";
import { buildContextPresets } from "../store/contextPresets";
import { getCachedSavedFilters } from "../store/savedFilterMedia";
import { getFilterPickerState, setFilterPickerState } from "../store/filterPickerState";
import { countRules, createEmptyTree } from "../store/goqlFilterTree";
import { summarizeFilterTree } from "../store/filterTreeSummary";
import { getViewStore } from "../store/registry";
import { getHomePersonHandle } from "../store/homePersonPreference";
import { formatHash } from "../hash";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";
import { FilterPickerDialog } from "./FilterPickerDialog";
import { ColumnSettingsDialog } from "./ColumnSettingsDialog";
import { goqlNamespaceForEndpoint } from "../store/goqlCompletion";

/** Row above FilterBar's search box, spanning just the list panel (App.tsx
 * mounts this inside the same Box as FilterBar/DataTable, not the aside) --
 * the view's plural label (e.g. "People", "Places"), plus a "Filters"
 * trigger right after it for any view whose GOQL namespace has presets
 * (see gqlFilterPresets.ts's namespaceForViewKey). People also gets a
 * "Go to home person" button at the far right (HomePersonButton below),
 * and every list a gear after it for its Columns dialog.
 * The per-type "Add a Person"/"Start a discussion" action used to live
 * here too; it now lives beside RelatedPanel's own Edit/Delete/etc row
 * instead (see related/AddButton.tsx's own doc comment for why). */
export function ListHeader({ view }: { view: ViewConfig }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  // Bumped by handleClear() below purely to force a re-render after it
  // updates filterPickerState.ts (a plain module-level Map, not itself
  // reactive) -- same reason clicking a dialog Apply/close already forces
  // one via setFiltersOpen, see that state's own doc comment.
  const [, forceRerender] = useState(0);
  const namespace = namespaceForViewKey(view.key);
  // Not reactive to a picker Apply from *this* mount -- reopening the
  // dialog re-reads the current count anyway, and closing it re-renders
  // this component (setFiltersOpen), which is when this needs to be
  // fresh. Good enough until the count also needs to reflect an Apply
  // made from a different mount of this same view (doesn't happen today).
  const activeCount = namespace ? countRules(getFilterPickerState(view.key, namespace).tree) : 0;
  // Human-readable ("Females AND (Widowed OR Divorced)"), not the compiled
  // GOQL -- resolves each rule against built-in presets plus whatever
  // Custom Rules FilterPickerDialog.tsx last fetched into its shared cache
  // (customRuleMedia.ts's getCachedCustomRules()), so a tree referencing
  // one still labels it correctly here without this component fetching
  // anything of its own. Same "good enough, not perfectly reactive"
  // tradeoff activeCount above already accepts.
  const summary = activeCount > 0 && namespace
    ? summarizeFilterTree(
        getFilterPickerState(view.key, namespace).tree,
        withContextPresets([...gqlFilterPresets, ...getCachedCustomRules().map(customRuleAsPreset)]),
      )
    : "";

  // Clears filterPickerState.ts optimistically (so the badge/dialog reset
  // immediately, no need to wait on a network round trip) and fires the
  // actual store-level clear in the background -- the same "clear the box,
  // then apply(null)" shape FilterBar.tsx's own CloseButton already uses.
  // A rare failure here just gets logged, matching how ViewStore itself
  // logs its own background-fill failures rather than surfacing every one
  // through visible UI.
  function handleClear() {
    if (!namespace) return;
    setFilterPickerState(view.key, createEmptyTree(namespace));
    forceRerender((n) => n + 1);
    getViewStore(view.key).clearPickerFilter().catch((err) => {
      console.error(`[${view.label}] clearing the Filters picker failed`, err);
    });
  }

  return (
    <Group justify="space-between" mb="sm" wrap="nowrap">
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Title order={4} style={{ flexShrink: 0 }}>{t(view.label)}</Title>
        {namespace && (
          <Button
            size="xs"
            variant={activeCount > 0 ? "light" : "subtle"}
            onClick={() => setFiltersOpen(true)}
            style={{ flexShrink: 0 }}
          >
            {t("Filters")}{activeCount > 0 ? ` (${activeCount})` : ""}
          </Button>
        )}
        {namespace && activeCount > 0 && (
          <CloseButton size="sm" onClick={handleClear} aria-label={t("Clear filters")} style={{ flexShrink: 0 }} />
        )}
        {namespace && activeCount > 0 && summary && (
          <Tooltip label={summary} multiline w={320} withArrow>
            <Text size="xs" c="dimmed" truncate style={{ minWidth: 0 }}>
              {summary}
            </Text>
          </Tooltip>
        )}
      </Group>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        {view.key === "person" && <HomePersonButton />}
        {goqlNamespaceForEndpoint(view.endpoint) && <ColumnsButton onClick={() => setColumnsOpen(true)} />}
      </Group>
      <ColumnSettingsDialog view={view} opened={columnsOpen} onClose={() => setColumnsOpen(false)} />
      {namespace && (
        <FilterPickerDialog
          opened={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          viewKey={view.key}
          viewLabel={view.label}
          namespace={namespace}
        />
      )}
    </Group>
  );
}

/** Opens the list's Columns dialog (ColumnSettingsDialog.tsx). */
function ColumnsButton({ onClick }: { onClick: () => void }) {
  const label = t("Columns");
  return (
    <Tooltip label={label} openDelay={400}>
      <ActionIcon variant="subtle" color="gray" onClick={onClick} aria-label={label}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </ActionIcon>
    </Tooltip>
  );
}

/** Selects the home person (homePersonPreference.ts) in the People list,
 * the same hash navigation a Home-page link uses. Read at render rather
 * than subscribed to: the preference is only ever set on the Home page,
 * and ListHeader remounts per view, so it's fresh whenever People shows. */
function HomePersonButton() {
  const handle = getHomePersonHandle();
  const label = handle ? t("Go to home person") : t("No home person set (set one on the Home page)");
  return (
    <Tooltip label={label} openDelay={400}>
      <ActionIcon
        variant="subtle"
        color="gray"
        data-disabled={!handle || undefined}
        onClick={() => {
          if (handle) window.location.hash = formatHash({ viewKey: "person", handle });
        }}
        aria-label={label}
        style={{ flexShrink: 0 }}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
          <path d="M10 20v-5.5h4V20" />
        </svg>
      </ActionIcon>
    </Tooltip>
  );
}

/** For the summary's labels only -- the "Matches saved filter" names come
 * from whatever the Filters dialog last fetched. */
function withContextPresets(base: GqlFilterPreset[]): GqlFilterPreset[] {
  return [...base, ...buildContextPresets(base, getCachedSavedFilters())];
}
