// Background check of the Gramps Connect blog (the project's GitHub Pages
// site, not a tree's own Blog view): once a day, fetch its Atom feed and
// count posts this browser hasn't seen yet. MenuBar shows that as a dot on
// the Help menu and a count on Help > Blog; opening the blog from there
// marks them as seen. No toast -- a blog post is news, not something to act
// on, so the quiet dot is enough. Same pattern as the Gramplet Store's
// check (pyodidePoc/grampletStoreNews.ts).
//
// State is per browser (the blog is the same for every tree and user) in
// localStorage under STORAGE_KEYS.blogNews. The very first check only
// records the feed's current posts as the baseline, so nobody is told
// "5 new posts" the first time they sign in.
import { BLOG_FEED_URL } from "../config";
import { STORAGE_KEYS } from "./storageKeys";

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How often an open tab looks at whether a day has passed -- a cheap
 * timestamp comparison, no request unless one is due. */
const TICK_MS = 60 * 60 * 1000;
/** Let the app finish its own startup requests first. */
const FIRST_TICK_MS = 30 * 1000;

export interface BlogNewsState {
  /** When the feed was last fetched (ms), successfully. */
  checkedAt: number;
  /** Every post id (the feed entry's <id>) already seen or baselined. */
  seenIds: string[];
  /** Post ids found since, not yet seen. */
  pending: string[];
}

/** Pure: the post ids in an Atom feed, newest first as the feed lists
 * them. A regex rather than DOMParser: the feed is our own build-blog.py
 * output, whose post bodies are escaped, so the only <id> tags are the
 * feed's own and its entries'. */
export function parseFeedIds(xml: string): string[] {
  const ids: string[] = [];
  for (const m of xml.matchAll(/<entry>[\s\S]*?<id>([^<]+)<\/id>/g)) ids.push(m[1].trim());
  return ids;
}

/** Pure: the state after a check that found `ids`. `prev` null is the
 * first check ever: every current post becomes the baseline. */
export function computeBlogNews(ids: string[], prev: BlogNewsState | null, now: number): BlogNewsState {
  const seenIds = prev ? prev.seenIds : ids;
  const seen = new Set(seenIds);
  return { checkedAt: now, seenIds, pending: ids.filter((id) => !seen.has(id)) };
}

/** Pure: the state after the user has opened the blog. Null before the
 * first check: there's nothing to mark yet, and writing an empty "seen"
 * list would make that first check report every post as new instead of
 * taking them as the baseline. */
export function acknowledgeBlogNews(prev: BlogNewsState | null): BlogNewsState | null {
  if (!prev) return null;
  return { checkedAt: prev.checkedAt, seenIds: [...new Set([...prev.seenIds, ...prev.pending])], pending: [] };
}

// ---- storage ---------------------------------------------------------------

function readState(): BlogNewsState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.blogNews);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BlogNewsState;
    if (!Array.isArray(parsed.seenIds) || !Array.isArray(parsed.pending)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state: BlogNewsState): void {
  try {
    localStorage.setItem(STORAGE_KEYS.blogNews, JSON.stringify(state));
  } catch {
    // storage blocked/full -- the dot just won't survive a reload
  }
}

// ---- live count (useSyncExternalStore) -------------------------------------

let snapshot = 0;
const listeners = new Set<() => void>();

function refreshSnapshot(): void {
  const next = readState()?.pending.length ?? 0;
  if (next !== snapshot) {
    snapshot = next;
    listeners.forEach((l) => l());
  }
}

export function subscribeBlogNews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How many blog posts this browser hasn't seen yet. */
export function getBlogNewsCount(): number {
  return snapshot;
}

/** Called when Help > Blog opens the blog: every post found so far
 * counts as seen. */
export function markBlogNewsSeen(): void {
  const next = acknowledgeBlogNews(readState());
  if (next) writeState(next);
  refreshSnapshot();
}

// ---- the background check --------------------------------------------------

let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  refreshSnapshot();
  if (typeof document !== "undefined" && document.hidden) return;
  // Read fresh: another tab may have checked (or opened the blog) since
  // this one last looked.
  const prev = readState();
  if (prev && Date.now() - prev.checkedAt < CHECK_INTERVAL_MS) return;
  inFlight = true;
  try {
    // Plain fetch(): a public static file, not gramps-web-api.
    const resp = await fetch(BLOG_FEED_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ids = parseFeedIds(await resp.text());
    // An empty or unreadable feed would otherwise become the baseline and
    // later report every post as new.
    if (ids.length === 0) throw new Error("no posts in the feed");
    writeState(computeBlogNews(ids, readState(), Date.now()));
    refreshSnapshot();
  } catch (err) {
    // Offline, or GitHub Pages is down: routine. checkedAt is left alone,
    // so the next hourly tick tries again.
    console.info("[blog news] background check failed:", err);
  } finally {
    inFlight = false;
  }
}

/** Starts the daily check for the signed-in session; returns a stop
 * function. */
export function startBlogNewsCheck(): () => void {
  refreshSnapshot();
  const first = setTimeout(() => void tick(), FIRST_TICK_MS);
  const interval = setInterval(() => void tick(), TICK_MS);
  const onVisible = () => {
    if (!document.hidden) void tick();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEYS.blogNews) refreshSnapshot();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("storage", onStorage);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("storage", onStorage);
  };
}
