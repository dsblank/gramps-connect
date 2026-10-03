// Data for the Home page (App.tsx's "home" route): per-type object counts,
// the most recently changed records across every type, the newest Topics
// (fetchRecentTopics), and the newest stories. Independent, lightweight
// reads -- none of them touch a ViewStore or its OPFS cache, since the
// point of a dashboard is a cheap glance at the whole tree, not loading all
// ten of it locally.
import { API_BASE } from "../config";
import { fetchPage, parseErrorMessage, type QueryItem } from "./api";
import { fetchServerState } from "./cacheMeta";
import { VIEWS, TOPICS_VIEW, STORY_VIEW, BLOG_VIEW, formatChange, type ViewConfig } from "./views";

/** The object types Home's Statistics/Recently-changed sections cover --
 * every VIEWS entry that names a real Gramps object type rather than a
 * fixed-filter window onto another one's table (GENERATED_VIEW/
 * TOPICS_VIEW both set `table` to something other than their own `key`;
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

/** Raw-object shapes the Recently Changed labels below read -- whatever
 * gramps-web-api's /api/search/ hit carries as `object` (the plain Gramps
 * JSON, plus `profile` when one was asked for), not a /query/ projection. */
interface RawSurname {
  surname?: string;
  primary?: boolean;
}

interface RawName {
  first_name?: string;
  surname_list?: RawSurname[];
}

type RawObject = Record<string, any>;

/** "Given Surname", the same everyday label personLabel()/displayName()
 * build -- `surname` mirrors the server's flat `surname` column
 * (Name.get_surname(): the primary Surname, else the first). */
function nameParts(name: RawName | undefined): { given: string; surname: string } {
  const surnames = name?.surname_list ?? [];
  const primary = surnames.find((s) => s.primary) ?? surnames[0];
  return { given: name?.first_name ?? "", surname: primary?.surname ?? "" };
}

function joinName(given: string | undefined, surname: string | undefined): string {
  return [given, surname].filter(Boolean).join(" ");
}

/** One-line label per type for the Recently Changed list, from a search
 * hit's raw object. Picks the same field(s) each view's own DataTable
 * columns treat as "the everyday label" for that type. Family and Citation
 * read `profile` (requested as profile=self) since the raw object only
 * carries the parents'/source's handles. */
const RECENT_LABEL: Record<string, (obj: RawObject) => string> = {
  person: (o) => {
    const { given, surname } = nameParts(o.primary_name);
    return joinName(given, surname) || "(unnamed)";
  },
  family: (o) =>
    [o.profile?.father, o.profile?.mother]
      .map((p) => joinName(p?.name_given, p?.name_surname))
      .filter(Boolean)
      .join(" & ") || "(family)",
  event: (o) => o.description || (typeof o.type === "string" ? o.type : o.type?.string) || "(event)",
  place: (o) => o.title || o.name?.value || "(place)",
  repository: (o) => o.name || "(repository)",
  source: (o) => o.title || "(source)",
  citation: (o) => [o.profile?.source?.title, o.page].filter(Boolean).join(", ") || "(citation)",
  media: (o) => o.desc || "(media)",
  note: (o) => (typeof o.text === "string" ? o.text : o.text?.string) || "(note)",
  tag: (o) => o.name || "(tag)",
};

/** Note types Recently Changed leaves out -- the same three NOTE_VIEW's own
 * baseFilter excludes (topics, stories and topic messages each have their
 * own Home panel or view), applied client-side here since /api/search/ has
 * no where_expr to push it into. */
const RECENT_EXCLUDED_NOTE_TYPES = new Set(["topic", "story", "topic-message"]);

/** How many search hits to ask for per wanted Recently Changed row. Covers
 * the excluded note types above, plus a gramps-web-api bug where a user
 * without PERM_VIEW_PRIVATE gets short pages: the public search index still
 * contains private objects, and /api/search/ drops them only *after*
 * paginating (one page of 10 came back with 3 on a tree whose newest edits
 * were private notes). */
const RECENT_OVERFETCH = 3;

/** The where_expr actually sent for `view`: just its own fixed
 * `view.baseFilter`, if it has one. Needed here because these fetches call
 * api.ts's fetchPage() directly rather than going through a ViewStore --
 * fetchPage sends exactly the where_expr it's given, with no idea that a
 * view like TOPICS_VIEW/STORY_VIEW/NOTE_VIEW carries a baseFilter of its
 * own (that combining is normally viewStore.ts's combinedFilter());
 * skipping it here silently turned "Latest topics" into "latest notes of
 * any kind". */
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

interface SearchHit {
  object_type: string;
  handle: string;
  object?: RawObject;
}

/** The `limit` most recently changed records across every type in
 * STAT_VIEWS, newest first -- one GET /api/search/ (query `*`, sorted by
 * `change` desc), the same call gramps-web's own Recently Changed widget
 * (GrampsjsViewRecentlyChanged.js) makes. This replaced one /query/ POST per
 * type: for a user without PERM_VIEW_PRIVATE (e.g. the Public guest) every
 * /query/ runs gramps-web-api's proxied path, deserializing that whole
 * table in Python just to return its top 10 -- ~5s of Home's load on a
 * 4.7k-person tree, versus ~0.1s for the search index, which keeps
 * `change` alongside every entry. A failed search (e.g. a server without a
 * search index) just leaves the panel empty rather than failing Home. */
export async function fetchRecentlyChanged(token: string, limit: number): Promise<RecentItem[]> {
  const viewKeys = new Set(STAT_VIEWS.map((v) => v.key));
  const params = new URLSearchParams({
    query: "*",
    sort: "-change",
    profile: "self",
    page: "1",
    pagesize: String(limit * RECENT_OVERFETCH),
  });
  let hits: SearchHit[];
  try {
    const res = await fetch(`${API_BASE}/api/search/?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await parseErrorMessage(res));
    hits = await res.json();
  } catch (err) {
    console.warn("[home] recently changed: search failed", err);
    return [];
  }
  return hits
    .filter((hit) => viewKeys.has(hit.object_type) && hit.object)
    .filter((hit) => !(hit.object_type === "note" && RECENT_EXCLUDED_NOTE_TYPES.has(String(hit.object!.type))))
    .map((hit) => {
      const obj = hit.object!;
      const build = RECENT_LABEL[hit.object_type];
      return {
        viewKey: hit.object_type,
        handle: hit.handle,
        grampsId: typeof obj.gramps_id === "string" ? obj.gramps_id : "",
        label: build ? build(obj) : String(obj.gramps_id ?? ""),
        changeUnix: Number(obj.change ?? 0),
      };
    })
    .filter((item) => item.changeUnix > 0)
    .sort((a, b) => b.changeUnix - a.changeUnix)
    .slice(0, limit);
}

export interface TopicItem {
  handle: string;
  grampsId: string;
  title: string;
  changeUnix: number;
}

/** The `limit` newest Topics -- same shape/query as fetchLatestStories
 * below, just for TOPICS_VIEW's own baseFilter (its "title" column's own
 * toDisplay already extracts TopicSpec's title out of the raw JSON, same
 * storyTitle() helper STORY_VIEW's "title" column uses -- see views.ts).
 * Simpler than the old fetchMessageBoards this replaces: a Topic already
 * carries its own title, so there's no per-row backlink GET needed to
 * resolve "what is this about" the way an untitled board message needed,
 * and no done/open state left to filter on (that concept was dropped along
 * with board messages -- see the Topics plan). */
export async function fetchRecentTopics(token: string, limit: number): Promise<TopicItem[]> {
  const { page } = await fetchPage(
    TOPICS_VIEW, token, null, false, combinedFilter(TOPICS_VIEW),
    [{ column: "change", direction: "desc" }], limit
  );
  return page.items.map((item) => ({
    handle: item.handle,
    grampsId: typeof item.gramps_id === "string" ? item.gramps_id : "",
    title: cellText(TOPICS_VIEW, item, "title"),
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
 * combinedFilter above), just capped and unfiltered by search. Same shape
 * as fetchRecentTopics above, just STORY_VIEW instead of TOPICS_VIEW. */
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

export interface BlogPostItem {
  handle: string;
  grampsId: string;
  title: string;
  author: string;
  changeUnix: number;
}

/** The `limit` newest Blog posts -- same shape/query as fetchLatestStories
 * above, just BLOG_VIEW instead of STORY_VIEW (its own "tagged Blog"
 * baseFilter still applies -- see combinedFilter above). Ported from
 * gramps-web's own dashboard widget (GrampsjsViewRecentBlogPosts.js), which
 * ran the same "one newest tagged Source" query via a HasTag Rule. */
export async function fetchLatestBlogPosts(token: string, limit: number): Promise<BlogPostItem[]> {
  const { page } = await fetchPage(
    BLOG_VIEW, token, null, false, combinedFilter(BLOG_VIEW),
    [{ column: "change", direction: "desc" }], limit
  );
  return page.items.map((item) => ({
    handle: item.handle,
    grampsId: typeof item.gramps_id === "string" ? item.gramps_id : "",
    title: cellText(BLOG_VIEW, item, "title"),
    author: cellText(BLOG_VIEW, item, "author"),
    changeUnix: Number(item.change ?? 0),
  }));
}

interface RawHomePerson {
  handle: string;
  gramps_id?: string;
  primary_name?: RawName;
}

/** The Home-person panel's one record, as the QueryItem shape
 * RefPickerField.tsx's personLabel() reads (handle/gramps_id/given_name/
 * surname) -- via a plain GET /api/people/<handle>, not api.ts's
 * fetchByHandle(). That one is a /query/ POST with a `handle == "..."`
 * where_expr, which for a user without PERM_VIEW_PRIVATE (e.g. the Public
 * guest) runs gramps-web-api's proxied query path: every Person in the tree
 * deserialized and privacy-checked in Python, ~2.5s on a 4.7k-person tree,
 * just to find one row. The GET is a direct lookup (~50ms) even through the
 * private proxy. Resolves to
 * null on 404 -- the person was deleted, or is private to this user --
 * same as fetchByHandle's empty result did. */
export async function fetchHomePerson(token: string, handle: string): Promise<QueryItem | null> {
  const res = await fetch(
    `${API_BASE}/api/people/${encodeURIComponent(handle)}?keys=handle,gramps_id,primary_name`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const person: RawHomePerson = await res.json();
  const { given, surname } = nameParts(person.primary_name);
  return { handle: person.handle, gramps_id: person.gramps_id ?? "", given_name: given, surname };
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
