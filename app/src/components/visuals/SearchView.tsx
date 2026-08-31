import { useEffect, useRef, useState } from "react";
import { Badge, Box, Button, CloseButton, Group, Image, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { API_BASE } from "../../config";
import { formatHash, parseHash } from "../../hash";
import { fetchSearch, sortByRelevance, type SearchHit } from "../../store/searchApi";
import { formatSearchUrlState, parseSearchUrlState } from "../../store/searchUrl";
import { formatChange, VIEWS } from "../../store/views";
import { summaryLine } from "../related/summary";
import { MediaThumbnail } from "../related/MediaThumbnail";
import { snippetFor } from "./searchSnippet";
import { t } from "../../i18n/i18n";
import { VisualFrame } from "./VisualFrame";

// Point 5 of the "make it a Google results page" request this view was
// redesigned for: a bounded top-N rather than an unbounded scroll -- each
// result now costs a `profile=all` computation server-side (searchApi.ts),
// so 10 is "the search page shows a handful of best matches", not a soft
// UI limit. `total` (from X-Total-Count) still says how many more there
// are; a way to actually reach them (real paging) is future work, not
// this pass -- see this component's own status line.
const RESULTS_LIMIT = 10;

// The `type` values SearchQueryArgs.type actually accepts (PRIMARY_GRAMPS_
// OBJECTS, lowercased) -- VIEWS also has Output/Messages/Story entries
// that aren't real primary object types and would 422 if sent as `type`,
// so the tab row is built from this list, not straight from VIEWS.
const SEARCHABLE_TYPES = [
  "person", "family", "event", "place", "repository", "source", "citation", "media", "note", "tag",
] as const;

function iconFor(objectType: string): string | undefined {
  return VIEWS.find((v) => v.key === objectType)?.icon;
}

function labelFor(objectType: string): string {
  return objectType.charAt(0).toUpperCase() + objectType.slice(1);
}

/** All/People/Family/Events/... directly under the search box, Google-
 * results-page style: the active one gets a solid underline, the rest sit
 * in dimmed text. Reuses VIEWS' own nav labels (VIEWS.find, same as
 * iconFor above) rather than labelFor's bare capitalization -- "People"
 * reads better as a tab than "Person" does. */
function TypeTabs({ active, onSelect }: { active: string | null; onSelect: (type: string | null) => void }) {
  const tabs: { key: string | null; label: string }[] = [
    { key: null, label: "All" },
    ...SEARCHABLE_TYPES.map((key) => ({ key, label: VIEWS.find((v) => v.key === key)!.label })),
  ];
  return (
    <Group gap="lg">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <UnstyledButton
            key={tab.key ?? "all"}
            onClick={() => onSelect(tab.key)}
            pb={4}
            style={{ borderBottom: isActive ? "2px solid var(--mantine-color-text)" : "2px solid transparent" }}
          >
            <Text size="sm" fw={isActive ? 600 : 400} c={isActive ? undefined : "dimmed"}>
              {t(tab.label)}
            </Text>
          </UnstyledButton>
        );
      })}
    </Group>
  );
}

function goToHit(hit: SearchHit) {
  window.location.hash = formatHash({ viewKey: hit.object_type, handle: hit.handle });
}

/** Writes `query`/`type` into the hash's own `?query` suffix (hash.ts's
 * HashRoute.query, via searchUrl.ts's encoding) -- `replaceState`, not
 * `pushState` or a plain `location.hash =` assignment: a submitted search
 * is meant to be *this page's* current state (so a link copied right now
 * points at it, and coming back here later restores it), not its own
 * Back-able step or a real navigation event -- the hash router already
 * gives every genuine page-to-page navigation its own history entry
 * (goToHit below, and every other formatHash caller, still assigns
 * `location.hash` directly), and `replaceState` deliberately doesn't fire
 * `hashchange`, so this can never trigger useHistorySync's own
 * hash-reapplying listener. A no-op write (the URL already says this) is
 * skipped so an unrelated re-render never nudges history state for
 * nothing. */
function syncSearchHash(state: { query: string; type: string | null }) {
  const next = formatHash({ viewKey: "search", query: formatSearchUrlState(state) });
  if (window.location.hash !== next) window.history.replaceState(window.history.state, "", next);
}

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

  // `overrides` lets a caller search with a selection that hasn't (or, for
  // the initial URL-restore below, never will) land in `query`/`typeFilter`
  // state yet, rather than a just-committed setState's stale closure value
  // -- Enter/the Search button call this with no argument and fall back to
  // whatever's already in state.
  async function runSearch(overrides?: { query?: string; type?: string | null }) {
    const trimmed = (overrides?.query ?? query).trim();
    const type = overrides?.type !== undefined ? overrides.type : typeFilter;
    const requestId = ++requestIdRef.current;
    // Keeps the URL in sync with whatever was actually just submitted --
    // including clearing it back down when the box is emptied and
    // resubmitted -- regardless of whether the fetch below succeeds.
    syncSearchHash({ query: trimmed, type });
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading", query: trimmed });
    try {
      const token = await getToken();
      const { hits, total } = await fetchSearch(token, trimmed, 1, RESULTS_LIMIT, type);
      if (requestIdRef.current !== requestId) return;
      // The server doesn't actually return these in relevance order -- see
      // sortByRelevance's own doc comment in searchApi.ts.
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

  // Restores a search from the hash's own `?query` suffix (a shared link,
  // a reload, or coming back to #/search after visiting a result) once, on
  // mount -- this component unmounts/remounts each time #/search stops/
  // starts being the active route (App.tsx's `{visualKey === "search" && ...}`),
  // so a fresh mount is exactly the right moment to re-read it. No cleanup
  // needed to strip it back out on the way elsewhere: `goToHit` below (and
  // every other formatHash caller) assigns a brand new hash with no query
  // of its own, which replaces this one's `?q=...` suffix outright, the
  // same way it already replaces the route itself -- see hash.ts's
  // HashRoute.query doc comment for why that's true specifically because
  // this lives *inside* the hash rather than the URL's own top-level
  // `location.search`.
  useEffect(() => {
    const initial = parseSearchUrlState(parseHash().query);
    if (initial.query) {
      setQuery(initial.query);
      setTypeFilter(initial.type);
      runSearch({ query: initial.query, type: initial.type });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = state.status === "loading";
  const error = state.status === "error" ? state.message : null;
  const hits = state.status === "ready" ? state.hits : [];
  const empty =
    state.status === "idle" ? (
      <Text size="sm" c="dimmed" ta="center">
        {t("Search across every person, family, event, place and more, then press Enter.")}
      </Text>
    ) : state.status === "ready" && state.hits.length === 0 ? (
      <Text size="sm" c="dimmed" ta="center">
        {t("No matches for")} "{state.query}"
      </Text>
    ) : undefined;

  return (
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
            <SearchResultRow key={`${hit.object_type}:${hit.handle}`} hit={hit} />
          ))}
        </Stack>
      </Box>
    </VisualFrame>
  );
}

// Raw object types that carry their own media_list (confirmed live off
// /api/search/ payloads: person/family/event/place/source/citation all
// have the field, sometimes empty; repository/note/tag never do, and
// media obviously doesn't need one -- it *is* the media). Only these are
// worth the extra per-hit lookup RecordThumbnail below makes.
const MEDIA_LIST_TYPES = new Set(["person", "family", "event", "place", "source", "citation"]);

function firstMediaHandle(obj: Record<string, unknown>): string | undefined {
  const list = obj.media_list as { ref?: string }[] | undefined;
  return Array.isArray(list) ? list.find((r) => r?.ref)?.ref : undefined;
}

/** A search card's thumbnail. A Media hit already knows its own mime
 * straight off the raw object -- no extra request. Every other type that
 * carries a media_list (see MEDIA_LIST_TYPES) gets exactly one small extra
 * lookup, GET /api/media/<handle> for metadata only (no file bytes), to
 * learn the referenced Media's mime -- MediaThumbnail.tsx needs it before
 * it will even attempt the actual thumbnail image. Bounded to at most
 * RESULTS_LIMIT of these per search: the "spend some hits on media" this
 * page's own brief asked for, not an unbounded fan-out. Renders nothing
 * while that lookup is in flight, has nothing to show, or fails -- same
 * "just don't show a thumbnail" fallback MediaThumbnail itself already
 * uses for a non-thumbnailable/missing file. */
function RecordThumbnail({ hit }: { hit: SearchHit }) {
  const [resolved, setResolved] = useState<{ handle: string; mime?: string } | null>(
    hit.object_type === "media" ? { handle: hit.handle, mime: hit.object.mime as string | undefined } : null
  );

  useEffect(() => {
    if (hit.object_type === "media" || !MEDIA_LIST_TYPES.has(hit.object_type)) return;
    const mediaHandle = firstMediaHandle(hit.object);
    if (!mediaHandle) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(mediaHandle)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const media = await res.json();
        if (!cancelled) setResolved({ handle: mediaHandle, mime: media.mime });
      } catch {
        // No thumbnail on this card -- not worth surfacing as an error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hit.object_type, hit.handle, hit.object]);

  if (!resolved) return null;
  return <MediaThumbnail handle={resolved.handle} mime={resolved.mime} size={72} />;
}

/** One "detailed section" -- a type icon/label line (the closest thing
 * this data has to Google's site-name/breadcrumb line), a bold clickable
 * title (summaryLine(), already generic across all ten types), and
 * whatever detail snippetFor() can say about it. RecordThumbnail above
 * covers the picture -- a Media hit's own file, or the first photo
 * attached to a person/family/event/place/source/citation. */
function SearchResultRow({ hit }: { hit: SearchHit }) {
  const icon = iconFor(hit.object_type);
  const snippet = snippetFor(hit.object_type, hit.object);
  const tagColor = hit.object_type === "tag" ? (hit.object.color as string | undefined) : undefined;
  const changed = formatChange(hit.object.change);
  return (
    <Group align="flex-start" gap="md" wrap="nowrap">
      <RecordThumbnail hit={hit} />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap={6}>
          {icon && <Image src={icon} alt="" w={16} h={16} />}
          <Badge size="xs" variant="light" color="gray">{t(labelFor(hit.object_type))}</Badge>
          {/* A tag's own color is its most identifying feature -- shown as
              a small swatch next to the type badge rather than described
              in words. */}
          {tagColor && (
            <Box w={12} h={12} style={{ borderRadius: 3, backgroundColor: tagColor, flexShrink: 0 }} />
          )}
        </Group>
        <UnstyledButton onClick={() => goToHit(hit)}>
          <Text size="lg" fw={500} c="var(--mantine-color-blue-6)" style={{ wordBreak: "break-word" }}>
            {summaryLine(hit.object_type, hit.object)}
          </Text>
        </UnstyledButton>
        {snippet.map((line, i) => (
          <Text key={i} size="sm" c="dimmed">{line}</Text>
        ))}
        {changed && (
          <Text size="xs" c="dimmed" mt={2}>{t("Last changed")} {changed}</Text>
        )}
      </Stack>
    </Group>
  );
}
