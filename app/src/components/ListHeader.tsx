import { useState } from "react";
import { Button, CloseButton, Group, Title } from "@mantine/core";
import { namespaceForViewKey } from "../data/gqlFilterPresets";
import { getFilterPickerState, setFilterPickerState } from "../store/filterPickerState";
import { countConditions, createEmptyTree } from "../store/goqlFilterTree";
import { getViewStore } from "../store/registry";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";
import { FilterPickerDialog } from "./FilterPickerDialog";

/** Row above FilterBar's search box, spanning just the list panel (App.tsx
 * mounts this inside the same Box as FilterBar/DataTable, not the aside) --
 * the view's plural label (e.g. "People", "Places"), plus a "Filters"
 * trigger right after it for any view whose GOQL namespace has presets
 * (see gqlFilterPresets.ts's namespaceForViewKey -- Person/Family today).
 * The per-type "Add a Person"/"Start a discussion" action used to live
 * here too; it now lives beside RelatedPanel's own Edit/Delete/etc row
 * instead (see related/AddButton.tsx's own doc comment for why). */
export function ListHeader({ view }: { view: ViewConfig }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const activeCount = namespace ? countConditions(getFilterPickerState(view.key, namespace).tree) : 0;

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
      <Group gap="xs" wrap="nowrap">
        <Title order={4}>{t(view.label)}</Title>
        {namespace && (
          <Button
            size="xs"
            variant={activeCount > 0 ? "light" : "subtle"}
            onClick={() => setFiltersOpen(true)}
          >
            {t("Filters")}{activeCount > 0 ? ` (${activeCount})` : ""}
          </Button>
        )}
        {namespace && activeCount > 0 && (
          <CloseButton size="sm" onClick={handleClear} aria-label={t("Clear filters")} />
        )}
      </Group>
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
