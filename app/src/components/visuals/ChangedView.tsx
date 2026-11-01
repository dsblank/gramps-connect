import { useEffect, useRef, useState } from "react";
import { Box, Button, Center, Stack, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchSearch, type SearchHit } from "../../store/searchApi";
import { isExcludedFromRecent } from "../../store/homeStats";
import { AGE_GROUP_LABELS, groupByAge } from "../../store/ageGroups";
import { t } from "../../i18n/i18n";
import { VisualFrame } from "./VisualFrame";
import { checkIndex, IndexNotice, ObjectResultCard, TypeTabs, type IndexState } from "./ObjectResultList";
import { ReindexDialog } from "../ReindexDialog";
import { LatestChangeColumns } from "./LatestChangeColumns";

/** Server rows per "Load more". Each costs a `profile=all` computation
 * (see searchApi.ts), so a page is a screenful, not the whole tree. */
const PAGE_SIZE = 20;

/** The type tab last picked, kept in memory across visits like Search
 * all's lastSearch -- coming Back from a record lands on the same tab. */
let lastType: string | null = null;

type State =
  | { status: "loading" }
  | { status: "ready"; hits: SearchHit[]; page: number; total: number; loadingMore: boolean }
  | { status: "error"; message: string };

/** View > Change Log: every record in the tree, most recently changed first,
 * grouped Today / Yesterday / Last 7 days / ... -- the full-page version of
 * Home's "Change Log" card, from the same query
 * (GET /api/search/?query=*&sort=-change). Like that panel it leaves out
 * Topics, Stories and topic messages, which have their own pages.
 *
 * That's the server's search index, so on a tree whose index was never
 * built it would list nothing; the same notice Search all shows explains
 * why instead. Fetched afresh on each visit, not kept live. */
export function ChangedView() {
  const [typeFilter, setTypeFilter] = useState<string | null>(lastType);
  const [state, setState] = useState<State>({ status: "loading" });
  const requestIdRef = useRef(0);
  const [indexState, setIndexState] = useState<IndexState>("unknown");
  const [reindexOpened, setReindexOpened] = useState(false);

  function refreshIndexState() {
    checkIndex().then(setIndexState, () => setIndexState("ok"));
  }
  useEffect(refreshIndexState, []);

  async function fetchPage(type: string | null, page: number): Promise<{ hits: SearchHit[]; total: number }> {
    const token = await getToken();
    return fetchSearch(token, "*", page, PAGE_SIZE, type, undefined, "-change");
  }

  async function loadFirst(type: string | null) {
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    try {
      const { hits, total } = await fetchPage(type, 1);
      if (requestIdRef.current !== requestId) return;
      setState({ status: "ready", hits, page: 1, total, loadingMore: false });
    } catch (err: any) {
      if (requestIdRef.current !== requestId) return;
      setState({ status: "error", message: err.message ?? String(err) });
    }
  }

  async function loadMore() {
    if (state.status !== "ready" || state.loadingMore) return;
    const requestId = requestIdRef.current;
    const nextPage = state.page + 1;
    setState({ ...state, loadingMore: true });
    try {
      const { hits, total } = await fetchPage(typeFilter, nextPage);
      if (requestIdRef.current !== requestId) return;
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        // A record changed between the two requests moves up to page 1
        // and can come back again further down -- keep its first showing.
        const seen = new Set(prev.hits.map((h) => `${h.object_type}:${h.handle}`));
        const fresh = hits.filter((h) => !seen.has(`${h.object_type}:${h.handle}`));
        return { status: "ready", hits: [...prev.hits, ...fresh], page: nextPage, total, loadingMore: false };
      });
    } catch (err: any) {
      if (requestIdRef.current !== requestId) return;
      setState({ status: "error", message: err.message ?? String(err) });
    }
  }

  useEffect(() => {
    loadFirst(typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectType(type: string | null) {
    lastType = type;
    setTypeFilter(type);
    loadFirst(type);
  }

  const ready = state.status === "ready" ? state : null;
  const visible = ready ? ready.hits.filter((hit) => !isExcludedFromRecent(hit.object_type, hit.object)) : [];
  // Measured in server rows, not visible ones: the excluded notes still
  // count against `total`.
  const hasMore = ready ? ready.page * PAGE_SIZE < ready.total : false;
  const indexEmpty = indexState === "missing" || indexState === "building";
  const empty =
    indexEmpty && visible.length === 0 ? (
      <IndexNotice state={indexState} onBuild={() => setReindexOpened(true)} />
    ) : ready && visible.length === 0 && !hasMore ? (
      <Text size="sm" c="dimmed" ta="center">{t("Nothing has changed yet.")}</Text>
    ) : undefined;
  const groups = groupByAge(visible, (hit) => Number(hit.object.change ?? 0));

  return (
    <>
      <VisualFrame
        title={t("Change Log")}
        loading={state.status === "loading"}
        loadingText={t("Loading recent changes…")}
        error={state.status === "error" ? state.message : null}
        empty={empty}
        scope={<TypeTabs active={typeFilter} onSelect={selectType} />}
        status={
          visible.length > 0 ? (
            <Text size="xs" c="dimmed">
              {t("Showing the")} {visible.length.toLocaleString()} {t("most recently changed")}
            </Text>
          ) : undefined
        }
      >
        <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {/* Wider than Search all's 720px column: each row carries the
              When/Who/What columns to the right of the card. */}
          <Stack gap="xl" maw={1320} ml="5%" p="md">
            {groups.map((group) => (
              <Stack key={group.key} gap="lg">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase">{t(AGE_GROUP_LABELS[group.key])}</Text>
                {group.items.map((hit) => (
                  <ObjectResultCard
                    key={`${hit.object_type}:${hit.handle}`}
                    hit={hit}
                    aside={<LatestChangeColumns hit={hit} />}
                  />
                ))}
              </Stack>
            ))}
            {hasMore && (
              <Center>
                <Button variant="default" onClick={loadMore} loading={ready?.loadingMore}>
                  {t("Load more")}
                </Button>
              </Center>
            )}
          </Stack>
        </Box>
      </VisualFrame>
      {/* Outside the frame, as in SearchView: the notice replaces the
          frame's children, which would unmount the dialog. */}
      <ReindexDialog
        opened={reindexOpened}
        onClose={() => setReindexOpened(false)}
        defaultFull
        onDone={() => {
          refreshIndexState();
          loadFirst(typeFilter);
        }}
      />
    </>
  );
}
