import { useEffect, useRef, useState } from "react";
import { Box, Button, CloseButton, Group, Stack, Text, TextInput } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchSearch, sortByRelevance, type SearchHit } from "../../store/searchApi";
import { t } from "../../i18n/i18n";
import { VisualFrame } from "./VisualFrame";
import { checkIndex, IndexNotice, ObjectResultCard, TypeTabs, type IndexState } from "./ObjectResultList";
import { ReindexDialog } from "../ReindexDialog";

// Point 5 of the "make it a Google results page" request this view was
// redesigned for: a bounded top-N rather than an unbounded scroll -- each
// result now costs a `profile=all` computation server-side (searchApi.ts),
// so 10 is "the search page shows a handful of best matches", not a soft
// UI limit. `total` (from X-Total-Count) still says how many more there
// are; a way to actually reach them (real paging) is future work, not
// this pass -- see this component's own status line.
const RESULTS_LIMIT = 10;

/** The last submitted query/type, remembered the same way FilterBar's own
 * per-view search-box text is (store/searchState.ts): in-memory only, not
 * the URL and not localStorage -- "what was I searching" scratch state, not
 * a durable or shareable preference. SearchView unmounts/remounts each time
 * #/search stops/starts being the active route (App.tsx's
 * `{visualKey === "search" && ...}`), so this module-level variable is what
 * survives that remount; a real page reload starts it fresh, same as every
 * other view's filter box. */
let lastSearch: { query: string; type: string | null } = { query: "", type: null };

type State =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "ready"; query: string; hits: SearchHit[]; total: number }
  | { status: "error"; query: string; message: string };

/** View > Search all: the one place in this app that hits gramps-web-api's
 * own full-text index (GET /api/search/, see searchApi.ts) instead of the
 * local synced cache -- every other search box here (FilterBar's, built on
 * simpleSearch.ts/personSearch.ts) filters one already-cached table by a
 * handful of columns. This one searches every field of all ten object
 * types at once, ranked by relevance.
 *
 * Explicit-submit (Enter or the Search button), not search-as-you-type --
 * matches gramps-web's own dedicated Search page (GrampsjsViewSearch.js),
 * confirmed by reading it: its query field only fires on Enter/a button
 * click, unlike its *object-picker* dialog, which does debounce on every
 * keystroke for a different, narrower use (typeahead while attaching an
 * existing record to something). A full top-level search page pays for a
 * `profile=all` lookup per result now (see RESULTS_LIMIT above), which
 * tips the balance further away from firing one on every keystroke. */
export function SearchView() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  // Guards a slow response against a newer search superseding it -- plain
  // state (not AbortController) is enough here since there's no debounce
  // timer to race against, just "the user submitted again before the
  // first one came back".
  const requestIdRef = useRef(0);
  const [indexState, setIndexState] = useState<IndexState>("unknown");
  const [reindexOpened, setReindexOpened] = useState(false);

  // A failed check just leaves the notice off: the search itself still
  // reports its own errors.
  function refreshIndexState() {
    checkIndex().then(setIndexState, () => setIndexState("ok"));
  }
  useEffect(refreshIndexState, []);

  // `overrides` lets a caller search with a selection that hasn't (or, for
  // the mount-restore below, never will) land in `query`/`typeFilter` state
  // yet, rather than a just-committed setState's stale closure value --
  // Enter/the Search button call this with no argument and fall back to
  // whatever's already in state.
  async function runSearch(overrides?: { query?: string; type?: string | null }) {
    const trimmed = (overrides?.query ?? query).trim();
    const type = overrides?.type !== undefined ? overrides.type : typeFilter;
    const requestId = ++requestIdRef.current;
    // Keeps the remembered search in sync with whatever was actually just
    // submitted -- including clearing it back down when the box is emptied
    // and resubmitted -- regardless of whether the fetch below succeeds.
    lastSearch = { query: trimmed, type };
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading", query: trimmed });
    try {
      const token = await getToken();
      const { hits, total } = await fetchSearch(token, trimmed, 1, RESULTS_LIMIT, type);
      if (requestIdRef.current !== requestId) return;
      // Servers before gramps-web-api v3.25.0 don't return these in
      // relevance order -- see sortByRelevance's own doc comment in
      // searchApi.ts.
      setState({ status: "ready", query: trimmed, hits: sortByRelevance(hits), total });
    } catch (err: any) {
      if (requestIdRef.current !== requestId) return;
      setState({ status: "error", query: trimmed, message: err.message ?? String(err) });
    }
  }

  // Selecting a tab before ever searching just remembers the choice for
  // whenever a search does happen (there's nothing to re-run yet); once
  // there's a live query, it re-searches immediately -- the Google-results
  // tabs re-filter on click, they don't wait for the search box to be
  // resubmitted.
  function selectType(type: string | null) {
    setTypeFilter(type);
    if (query.trim()) runSearch({ type });
  }

  // Restores the last submitted search (coming back to #/search after
  // visiting a result) once, on mount -- see `lastSearch`'s own doc comment
  // for why this is in-memory only, not a reload-surviving or shareable
  // link.
  useEffect(() => {
    if (lastSearch.query) {
      setQuery(lastSearch.query);
      setTypeFilter(lastSearch.type);
      runSearch({ query: lastSearch.query, type: lastSearch.type });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = state.status === "loading";
  const error = state.status === "error" ? state.message : null;
  const hits = state.status === "ready" ? state.hits : [];
  const indexEmpty = indexState === "missing" || indexState === "building";
  const empty =
    indexEmpty && hits.length === 0 ? (
      <IndexNotice state={indexState} onBuild={() => setReindexOpened(true)} />
    ) : state.status === "idle" ? (
      <Text size="sm" c="dimmed" ta="center">
        {t("Search across every person, family, event, place and more, then press Enter.")}
      </Text>
    ) : state.status === "ready" && state.hits.length === 0 ? (
      <Text size="sm" c="dimmed" ta="center">
        {t("No matches for")} "{state.query}"
      </Text>
    ) : undefined;

  return (
    <>
      <VisualFrame
        title={t("Search all")}
        loading={loading}
        error={error}
        empty={empty}
        scope={<TypeTabs active={typeFilter} onSelect={selectType} />}
        toolbar={
          <Group gap="xs" wrap="nowrap" style={{ width: "80%" }}>
            <TextInput
              size="sm"
              style={{ flex: 1 }}
              placeholder={t("Search every record in the tree…")}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              rightSection={query ? <CloseButton size="sm" onClick={() => setQuery("")} /> : null}
              aria-label="Search all"
            />
            <Button size="sm" onClick={() => runSearch()} style={{ flexShrink: 0 }}>{t("Search")}</Button>
          </Group>
        }
        status={
          state.status === "ready" && state.hits.length > 0 ? (
            <Text size="xs" c="dimmed">
              {state.hits.length.toLocaleString()} {t("of")} {state.total.toLocaleString()} {t("results for")} "{state.query}"
            </Text>
          ) : undefined
        }
      >
        <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {/* Offset from the left edge rather than centered -- the "Google
              results page" ask specifically: a real Google results page sits
              in a fixed-width column that starts well short of centered,
              not a column centered in the viewport (which reads more like a
              document than a list of results). */}
          <Stack gap="xl" maw={720} ml="10%" p="md">
            {hits.map((hit) => (
              <ObjectResultCard key={`${hit.object_type}:${hit.handle}`} hit={hit} />
            ))}
          </Stack>
        </Box>
      </VisualFrame>
      {/* Outside the frame: while the notice shows, VisualFrame renders
          it in place of its children, which would unmount the dialog. */}
      <ReindexDialog
        opened={reindexOpened}
        onClose={() => setReindexOpened(false)}
        defaultFull
        onDone={() => {
          refreshIndexState();
          if (query.trim()) runSearch();
        }}
      />
    </>
  );
}

