// Data for the Home page (App.tsx's "home" route): per-type object counts,
// the most recently changed records across every type, and the newest
// Gramps Connect messages. Three independent, lightweight reads -- none of
// them touch a ViewStore or its OPFS cache, since the point of a dashboard
// is a cheap glance at the whole tree, not loading all ten of it locally.
import { fetchPage, type QueryItem } from "./api";
import { fetchServerState } from "./cacheMeta";
import { VIEWS, MESSAGES_VIEW, STORY_VIEW, formatChange, type ViewConfig } from "./views";

/** The object types Home's Statistics/Recently-changed sections cover --
 * every VIEWS entry that names a real Gramps object type rather than a
 * fixed-filter window onto another one's table (GENERATED_VIEW/
 * MESSAGES_VIEW both set `table` to something other than their own `key`;
 * see ViewConfig.table's doc comment). Counting or "recently changed"-ing
 * those two would double up rows already reachable through Media/Notes. */
export const STAT_VIEWS: ViewConfig[] = VIEWS.filter((v) => (v.table ?? v.key) === v.key);

/** Reads a cached column's value back the way DataTable does: `toSql`
 * first (a freshly fetched item is shaped like the server's JSON response,
 * not yet the string a json_path column's `toDisplay` expects -- see
 * views.ts's ColumnConfig), then `toDisplay`, falling back to a plain
 * String() when a column defines neither. */
function cellText(view: ViewConfig, item: QueryItem, key: string): string {
  const column = view.columns.find((c) => c.key === key);
  if (!column) return "";
  const raw = item[key];
  const stored = column.toSql ? column.toSql(raw) : (raw as string | number | null | undefined);
  if (stored === null || stored === undefined || stored === "") return "";
  const displayed = column.toDisplay ? column.toDisplay(stored) : String(stored);
  // toDisplay may return non-text ReactNode (e.g. Tag's color swatch) for
  // DataTable's own rendering -- Home's Recently Changed list wants text,
  // so fall back to the raw stored value rather than stringifying JSX.
  return typeof displayed === "string" ? displayed : String(stored);
}

/** One-line label per type for the Recently Changed list -- deliberately
 * not summary.ts's summaryLine(): that switch reads a *raw* fetched object
 * (Person.primary_name, Family.extended.father/mother, ...), while this
 * reads a query-projected QueryItem, whose keys and shapes are each view's
 * own ColumnConfig list instead. Picks the same field(s) that view's own
 * simpleSearch/DataTable columns already treat as "the everyday label" for
 * that type. */
const RECENT_LABEL: Record<string, (view: ViewConfig, item: QueryItem) => string> = {
  person: (v, i) => [cellText(v, i, "given_name"), cellText(v, i, "surname")].filter(Boolean).join(" ") || "(unnamed)",
  family: (v, i) =>
    [cellText(v, i, "father_name"), cellText(v, i, "mother_name")].filter(Boolean).join(" & ") || "(family)",
  event: (v, i) => cellText(v, i, "description") || cellText(v, i, "event_type") || "(event)",
  place: (v, i) => cellText(v, i, "title") || "(place)",
  repository: (v, i) => cellText(v, i, "name") || "(repository)",
  source: (v, i) => cellText(v, i, "title") || "(source)",
  citation: (v, i) => [cellText(v, i, "source_title"), cellText(v, i, "page")].filter(Boolean).join(", ") || "(citation)",
  media: (v, i) => cellText(v, i, "desc") || "(media)",
  note: (v, i) => cellText(v, i, "text") || "(note)",
  tag: (v, i) => cellText(v, i, "name") || "(tag)",
};

/** The where_expr actually sent for `view`: just its own fixed
 * `view.baseFilter`, if it has one. Needed here because these fetches call
 * api.ts's fetchPage() directly rather than going through a ViewStore --
 * fetchPage sends exactly the where_expr it's given, with no idea that a
 * view like MESSAGES_VIEW/STORY_VIEW/NOTE_VIEW carries a baseFilter of its
 * own (that combining is normally viewStore.ts's combinedFilter());
 * skipping it here silently turned "Latest messages" into "latest notes of
 * any kind", and (before NOTE_VIEW's own baseFilter excluded them) let
 * messages/stories double up in Recently Changed under NOTE_VIEW's plain,
 * convention-blind `text` column. */
function combinedFilter(view: ViewConfig): string | null {
  return view.baseFilter ?? null;
}

export interface RecentItem {
  viewKey: string;
  handle: string;
  grampsId: string;
  label: string;
  changeUnix: number;
}

function toRecentItem(view: ViewConfig, item: QueryItem): RecentItem {
  const build = RECENT_LABEL[view.key];
  return {
    viewKey: view.key,
    handle: item.handle,
    grampsId: typeof item.gramps_id === "string" ? item.gramps_id : "",
    label: build ? build(view, item) : cellText(view, item, "gramps_id"),
    changeUnix: Number(item.change ?? 0),
  };
}

/** The `limit` most recently changed records across every type in
 * STAT_VIEWS, newest first. Each type is asked for its own top `limit`
 * (an ordinary /query/ POST, order_by change desc -- no different from
 * what DataTable itself sends) in parallel, then the ~10*limit results are
 * merged and cut down to `limit`; a type this user can't query at all (a
 * restrictive role) just contributes nothing rather than failing the whole
 * page. */
export async function fetchRecentlyChanged(token: string, limit: number): Promise<RecentItem[]> {
  const results = await Promise.all(
    STAT_VIEWS.map(async (view) => {
      try {
        const { page } = await fetchPage(
          view, token, null, false, combinedFilter(view),
          [{ column: "change", direction: "desc" }], limit
        );
        return page.items.map((item) => toRecentItem(view, item));
      } catch {
        return [] as RecentItem[];
      }
    })
  );
  return results
    .flat()
    .filter((item) => item.changeUnix > 0)
    .sort((a, b) => b.changeUnix - a.changeUnix)
    .slice(0, limit);
}

export interface MessageItem {
  handle: string;
  grampsId: string;
  author: string;
  message: string;
  changeUnix: number;
}

/** The `limit` newest Gramps Connect messages -- same query MESSAGES_VIEW's
 * own table sends (its baseFilter, "tagged message", still applies -- see
 * combinedFilter above), just capped and unfiltered by search. */
export async function fetchLatestMessages(token: string, limit: number): Promise<MessageItem[]> {
  const { page } = await fetchPage(
    MESSAGES_VIEW, token, null, false, combinedFilter(MESSAGES_VIEW),
    [{ column: "change", direction: "desc" }], limit
  );
  return page.items.map((item) => ({
    handle: item.handle,
    grampsId: typeof item.gramps_id === "string" ? item.gramps_id : "",
    author: cellText(MESSAGES_VIEW, item, "author"),
    message: cellText(MESSAGES_VIEW, item, "text"),
    changeUnix: Number(item.change ?? 0),
  }));
}

export interface StoryItem {
  handle: string;
  grampsId: string;
  title: string;
  changeUnix: number;
}

/** The `limit` newest Gramps Connect stories -- same query STORY_VIEW's own
 * table sends (its baseFilter, "tagged story", still applies -- see
 * combinedFilter above), just capped and unfiltered by search. Mirrors
 * fetchLatestMessages above, minus the author/message split a story's
 * single `title` column has no equivalent of. */
export async function fetchLatestStories(token: string, limit: number): Promise<StoryItem[]> {
  const { page } = await fetchPage(
    STORY_VIEW, token, null, false, combinedFilter(STORY_VIEW),
    [{ column: "change", direction: "desc" }], limit
  );
  return page.items.map((item) => ({
    handle: item.handle,
    grampsId: typeof item.gramps_id === "string" ? item.gramps_id : "",
    title: cellText(STORY_VIEW, item, "title"),
    changeUnix: Number(item.change ?? 0),
  }));
}

/** Per-type row counts, keyed by STAT_VIEWS' own `key`s. Reuses cacheMeta's
 * already-memoized /api/metadata/ + history read (every ViewStore's own
 * staleness check shares the same one request per page load) rather than
 * issuing a second, Home-specific fetch of the same data. */
export async function fetchHomeCounts(): Promise<Record<string, number>> {
  const state = await fetchServerState();
  return state.counts;
}

/** "15 minutes ago" / "a month ago", from a `change` column's raw Unix
 * seconds. Same relative-time logic views.ts's DataTable columns use for
 * their own "Last changed" column -- re-exported here under its established
 * Home-dashboard name rather than duplicated. */
export const timeAgo = formatChange;
