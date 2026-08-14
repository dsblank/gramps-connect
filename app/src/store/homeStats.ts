// Data for the Home page (App.tsx's "home" route): per-type object counts,
// the most recently changed records across every type, and the newest
// Gramps Connect messages. Three independent, lightweight reads -- none of
// them touch a ViewStore or its OPFS cache, since the point of a dashboard
// is a cheap glance at the whole tree, not loading all ten of it locally.
import { fetchPage, type QueryItem } from "./api";
import { fetchServerState } from "./cacheMeta";
import { VIEWS, MESSAGES_VIEW, type ViewConfig } from "./views";

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
  return column.toDisplay ? column.toDisplay(stored) : String(stored);
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

/** The where_expr actually sent for `view`: any fixed `view.baseFilter`
 * AND-ed with an extra, caller-supplied clause. Needed here because these
 * fetches call api.ts's fetchPage() directly rather than going through a
 * ViewStore -- fetchPage sends exactly the where_expr it's given, with no
 * idea that a view like MESSAGES_VIEW carries a baseFilter of its own (that
 * combining is normally viewStore.ts's combinedFilter()); skipping it here
 * silently turned "Latest messages" into "latest notes of any kind". */
function combinedFilter(view: ViewConfig, extra: string | null): string | null {
  const base = view.baseFilter ?? null;
  if (base && extra) return `(${base}) and (${extra})`;
  return base ?? extra;
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

/** Recently Changed's own where_expr, per type -- only Notes needs one. A
 * Gramps Connect message *is* a Note (one tagged "message", see
 * MESSAGES_VIEW's baseFilter), already shown -- with its author split out
 * and its own icon -- by the Messages panel above this one. Without this
 * exclusion, every message would also turn up a second time here, labeled
 * from NOTE_VIEW's plain `text` column, which doesn't know about the
 * "author: message" convention and so reads as one run-on line. */
const RECENT_WHERE: Partial<Record<string, string>> = {
  note: "not exists(tags, name == 'message')",
};

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
          view, token, null, false, combinedFilter(view, RECENT_WHERE[view.key] ?? null),
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
    MESSAGES_VIEW, token, null, false, combinedFilter(MESSAGES_VIEW, null),
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

/** Per-type row counts, keyed by STAT_VIEWS' own `key`s. Reuses cacheMeta's
 * already-memoized /api/metadata/ + history read (every ViewStore's own
 * staleness check shares the same one request per page load) rather than
 * issuing a second, Home-specific fetch of the same data. */
export async function fetchHomeCounts(): Promise<Record<string, number>> {
  const state = await fetchServerState();
  return state.counts;
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** "15 minutes ago" / "a month ago", from a `change` column's raw Unix
 * seconds -- Home's dashboard reads better at a glance than views.ts's
 * plain-date formatChange(), which the object tables themselves keep
 * (a sortable column benefits from a fixed-width absolute date; a
 * dashboard skim doesn't). */
export function timeAgo(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "";
  const diffSeconds = unixSeconds - Date.now() / 1000;
  for (const [unit, secondsInUnit] of TIME_UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return RELATIVE_TIME.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return RELATIVE_TIME.format(Math.round(diffSeconds / 60), "minute");
}
