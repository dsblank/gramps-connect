import { useEffect, useState } from "react";
import { Anchor, Card, Loader, Stack, Text, TextInput } from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchPage, type QueryItem } from "../store/api";
import type { ViewConfig } from "../store/views";

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
}

/** A generic single-field "pick an existing record" search, used by
 * ObjectEditDialog.tsx's reference fields (Event's Place, Citation's
 * Source). Same debounced-search/result-list/total-count-hint shape as
 * FamilyEditDialog.tsx's PersonSearch, built separately rather than
 * shared -- see this file's own doc comment on why. */
export function RecordPicker({ view, searchField, placeholder, onPick }: RecordPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = query.trim().replace(/['\\]/g, "");
    if (term.length < 2) {
      setResults([]);
      setTotalCount(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const whereExpr = `like(${searchField}, '${term}%')`;
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
  }, [query, view, searchField]);

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
        <Card withBorder padding="xs">
          <Stack gap={4}>
            {results.map((item) => (
              <Anchor key={item.handle} component="button" type="button" size="sm" onClick={() => onPick(item)}>
                {(item[searchField] as string | undefined) || "(untitled)"}
              </Anchor>
            ))}
          </Stack>
        </Card>
      )}
      {totalCount !== null && totalCount > results.length && (
        <Text size="xs" c="dimmed">
          Showing {results.length} of {totalCount} — refine your search to narrow this down.
        </Text>
      )}
    </Stack>
  );
}
