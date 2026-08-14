import { useEffect, useState } from "react";
import { Button, Card, Group, Loader, NavLink, ScrollArea, Stack, Text, TextInput } from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchPage, type QueryItem } from "../store/api";
import type { ViewConfig } from "../store/views";
import { withGrampsId } from "./related/summary";

// Capped rather than raised when a search is too broad: a picker that can
// return hundreds of matches needs a narrower query, not a longer dropdown
// (same reasoning as FamilyEditDialog.tsx's PersonSearch).
const RESULT_LIMIT = 20;

interface RecordPickerProps {
  view: ViewConfig;
  /** The flat column to search, prefix-matched (`like(<field>, '<term>%')`)
   * -- e.g. "title" for Place/Source. A plain prefix match is enough for
   * every reference field ObjectEditDialog.tsx needs a picker for; nothing
   * here needs FamilyEditDialog's name-specific parsing (comma order,
   * multi-word given/surname), so this stays its own, simpler component
   * rather than generalizing that one. */
  searchField: string;
  placeholder: string;
  onPick: (item: QueryItem) => void;
  /** Overrides the plain `like(searchField, '<term>%')` above -- passed by
   * AttachControl.tsx as `view.simpleSearch.buildExpr`, the exact same
   * multi-field OR search FilterBar's own plain-text search mode uses for
   * that type, rather than a single flat prefix match. */
  buildExpr?: (term: string) => string | null;
  /** Overrides `item[searchField]` as each result's label -- passed by
   * AttachControl.tsx's own pickerResultLabel(), built from the same
   * flat query-list column shape this component's own `results` are in
   * (not summary.ts's summaryLine(), which expects a RelatedPanel-style
   * extended detail fetch this component never makes). */
  renderLabel?: (item: QueryItem) => string;
  /** When set, clicking a row only highlights it -- `onPick` fires only
   * from the "Select" button below the list, once confirmed. Passed by
   * AttachControl.tsx's own dialog (a deliberate, named action to commit
   * to); ObjectEditDialog.tsx's inline reference-field pickers leave this
   * unset and keep the original immediate-pick-on-click behavior, since
   * those aren't a separate "confirm this" dialog the way AttachControl's
   * is. */
  confirmWithButton?: boolean;
}

/** A generic single-field "pick an existing record" search, used by
 * ObjectEditDialog.tsx's reference fields (Event's Place, Citation's
 * Source) and AttachControl.tsx's attach dialogs. Same debounced-search/
 * result-list shape as FamilyEditDialog.tsx's PersonSearch, built
 * separately rather than shared -- see this file's own doc comment on why.
 * An empty search browses the view's default-ordered list immediately
 * (no where_expr at all) rather than showing nothing until 2+ characters
 * are typed -- there's something to pick from the moment this opens. */
export function RecordPicker({
  view, searchField, placeholder, onPick, buildExpr, renderLabel, confirmWithButton,
}: RecordPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim().replace(/['\\]/g, "");
    const whereExpr = term.length === 0 ? null : buildExpr ? buildExpr(term) : `like(${searchField}, '${term}%')`;
    let cancelled = false;
    setLoading(true);
    // A fresh search invalidates whatever was highlighted from the
    // previous result set (it may not even be shown anymore).
    setSelectedHandle(null);
    (async () => {
      const token = await getToken();
      const { page, totalCount: count } = await fetchPage(view, token, null, true, whereExpr, view.orderBy, RESULT_LIMIT);
      if (!cancelled) {
        setResults(page.items);
        setTotalCount(count);
      }
    })()
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          setTotalCount(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, view, searchField, buildExpr]);

  const selectedItem = results.find((item) => item.handle === selectedHandle) ?? null;

  return (
    <Stack gap="xs">
      <TextInput
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        rightSection={loading ? <Loader size="xs" /> : null}
        autoFocus
      />
      {results.length > 0 && (
        <Card withBorder padding={0} style={{ overflow: "hidden" }}>
          {/* Fixed height, not the dialog itself -- RESULT_LIMIT (20) rows
              can run taller than the dialog; only this list should scroll,
              keeping the search box above and the Select button below
              (when confirmWithButton) always in view. */}
          <ScrollArea.Autosize mah={300} type="auto">
            <Stack gap={0}>
              {results.map((item) => (
                <NavLink
                  key={item.handle}
                  label={
                    renderLabel
                      ? renderLabel(item)
                      : withGrampsId(
                          item.gramps_id as string | undefined,
                          (item[searchField] as string | undefined) || "(untitled)"
                        )
                  }
                  active={confirmWithButton ? item.handle === selectedHandle : undefined}
                  onClick={() => (confirmWithButton ? setSelectedHandle(item.handle) : onPick(item))}
                  styles={{
                    label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                  }}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Card>
      )}
      {results.length === 0 && !loading && (
        <Text size="xs" c="dimmed">No matches</Text>
      )}
      {totalCount !== null && totalCount > results.length && (
        <Text size="xs" c="dimmed">
          Showing {results.length} of {totalCount} — refine your search to narrow this down.
        </Text>
      )}
      {confirmWithButton && (
        <Group justify="flex-end">
          <Button disabled={!selectedItem} onClick={() => selectedItem && onPick(selectedItem)}>
            Select
          </Button>
        </Group>
      )}
    </Stack>
  );
}
