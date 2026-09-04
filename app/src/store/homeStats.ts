// Data for the Home page (App.tsx's "home" route): per-type object counts,
// the most recently changed records across every type, the newest Gramps
// Connect conversations (fetchMessageBoards' `messages`, one row per
// object rather than per note) and open ToDos (that same call's `todos`),
// and the newest stories. Independent, lightweight reads -- none of them
// touch a ViewStore or its OPFS cache, since the point of a dashboard is a
// cheap glance at the whole tree, not loading all ten of it locally.
import { fetchPage, type QueryItem } from "./api";
import { fetchServerState } from "./cacheMeta";
import { fetchObjectExtended, getBacklinks } from "./objectDetail";
import { getTagHandleCached, TODO_DONE_TAG } from "./notesApi";
import { VIEWS, MESSAGES_VIEW, STORY_VIEW, formatChange, type ViewConfig } from "./views";
import { summaryLine } from "../components/related/summary";

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

/** Which object (if any) a message note is about -- the resolved target of
 * its *first* backlink (a message attached via MessageButton.tsx's
 * attachNoteToObject has exactly one; a hand-attached one with more than
 * one just shows whichever the backlinks map lists first). `label` is
 * built the same way every other reference row in the app is
 * (summary.ts's summaryLine -- "[I0288] Fred Blank"). */
export interface MessageTarget {
  viewKey: string;
  handle: string;
  label: string;
}

export interface MessageItem {
  handle: string;
  grampsId: string;
  author: string;
  message: string;
  changeUnix: number;
  about: MessageTarget;
}

/** A message with no backlink at all -- created via ListHeader's own "Add
 * ToDo" trigger (MessageComposer with no `about`), never attached to any
 * object's note_list, so there's nothing to hold a conversation "about".
 * Same shape as MessageItem minus `about`. */
export interface TodoItem {
  handle: string;
  grampsId: string;
  author: string;
  message: string;
  changeUnix: number;
}

interface ResolvedMessage {
  handle: string;
  grampsId: string;
  author: string;
  message: string;
  changeUnix: number;
  about: MessageTarget | null;
  done: boolean;
}

/** Candidate pool size, relative to the bigger of the two panels' own
 * limits -- a heuristic, not exhaustive pagination: enough headroom that a
 * handful of messages piled onto the same object (collapsed to one row
 * below) or already marked done (dropped from the ToDo panel) still leave
 * `limit` rows in the common case, without walking the whole Messages
 * table on every Home page load. */
const CANDIDATE_MULTIPLIER = 6;

/** Resolves one query-projected message row into everything both Home
 * panels need to decide where it belongs: its target object (via a full
 * GET with backlinks=1 -- the bulk /query/ endpoint this candidate came
 * from can't resolve backlinks itself, see objectDetail.ts) and its
 * done/open state (that same GET's plain `tag_list`, compared against the
 * resolved "todo-done" tag handle -- cheaper to piggyback here than a
 * second per-row request). */
async function resolveMessage(token: string, item: QueryItem, doneTagHandle: string | null): Promise<ResolvedMessage> {
  const detail = await fetchObjectExtended(token, MESSAGES_VIEW, item.handle);
  const backlinks = getBacklinks(detail);
  let about: MessageTarget | null = null;
  for (const [viewKey, items] of Object.entries(backlinks)) {
    const target = items[0] as { handle?: string } | undefined;
    if (target?.handle) {
      about = { viewKey, handle: target.handle, label: summaryLine(viewKey, target) || viewKey };
      break;
    }
  }
  const tagList = (detail.tag_list as string[] | undefined) ?? [];
  return {
    handle: item.handle,
    grampsId: typeof item.gramps_id === "string" ? item.gramps_id : "",
    author: cellText(MESSAGES_VIEW, item, "author"),
    message: cellText(MESSAGES_VIEW, item, "text"),
    changeUnix: Number(item.change ?? 0),
    about,
    done: Boolean(doneTagHandle && tagList.includes(doneTagHandle)),
  };
}

/** Home's Messages and ToDo panels, resolved together in one pass (both
 * need the same per-candidate backlink/tag_list lookup, so splitting this
 * into two exported fetches would just look up most rows twice). Reads
 * the `Math.max(messageLimit, todoLimit) * CANDIDATE_MULTIPLIER` newest
 * messages, newest first, then:
 * - Messages: the ones with a resolved target, deduped down to each
 *   object's own single newest message -- a "conversation" is everything
 *   said about one record, so a glance at Home should show where the
 *   activity is, not `messageLimit` rows that might all be the same
 *   back-and-forth on one person.
 * - ToDos: the ones with no target at all (nothing to hold a conversation
 *   "about" -- see TodoItem) and not yet marked done. */
export async function fetchMessageBoards(
  token: string,
  messageLimit: number,
  todoLimit: number
): Promise<{ messages: MessageItem[]; todos: TodoItem[] }> {
  const poolSize = Math.max(messageLimit, todoLimit) * CANDIDATE_MULTIPLIER;
  const [{ page }, doneTagHandle] = await Promise.all([
    fetchPage(
      MESSAGES_VIEW, token, null, false, combinedFilter(MESSAGES_VIEW),
      [{ column: "change", direction: "desc" }], poolSize
    ),
    getTagHandleCached(token, TODO_DONE_TAG).catch(() => null),
  ]);
  const resolved = await Promise.all(page.items.map((item) => resolveMessage(token, item, doneTagHandle)));

  const messages: MessageItem[] = [];
  const seenObjects = new Set<string>();
  for (const r of resolved) {
    if (!r.about) continue;
    const key = `${r.about.viewKey}:${r.about.handle}`;
    if (seenObjects.has(key)) continue;
    seenObjects.add(key);
    messages.push({ handle: r.handle, grampsId: r.grampsId, author: r.author, message: r.message, changeUnix: r.changeUnix, about: r.about });
    if (messages.length === messageLimit) break;
  }

  const todos: TodoItem[] = resolved
    .filter((r) => !r.about && !r.done)
    .slice(0, todoLimit)
    .map(({ handle, grampsId, author, message, changeUnix }) => ({ handle, grampsId, author, message, changeUnix }));

  return { messages, todos };
}

export interface StoryItem {
  handle: string;
  grampsId: string;
  title: string;
  changeUnix: number;
}

/** The `limit` newest Gramps Connect stories -- same query STORY_VIEW's own
 * table sends (its baseFilter, "tagged story", still applies -- see
 * combinedFilter above), just capped and unfiltered by search. Simpler
 * than fetchMessageBoards above -- no target object to resolve, no done
 * state, just the author/message split a story's single `title` column
 * has no equivalent of. */
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
