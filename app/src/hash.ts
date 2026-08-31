// A minimal, library-free "router" -- the app's whole navigable state is
// "which view, which selected handle" (see useHistorySync.ts, the only
// place that reads/writes this), so a URL hash fragment plus the native
// hashchange event is enough; pulling in react-router for two fields would
// be a lot of ceremony this app doesn't need. Hash-based rather than a real
// path so it works with whatever static file server ships app/'s build --
// no server-side SPA-fallback routing required.
import { VIEWS } from "./store/views";

export interface HashRoute {
  viewKey: string;
  handle: string | null;
  /** Only ever set on a visual route -- see VisualSubject. */
  subject: VisualSubject | null;
}

/** The record a visual is scoped to, when it's showing one record's data
 * rather than the whole tree: "Bob Smith's events on the timeline", "this
 * family's places on the map". Written into the route rather than held in
 * component state so a scoped visual is a real page like every other one
 * here -- Back steps out of the scope, a reload keeps it, and the URL can be
 * pasted to someone else. That the route names the *subject* (and not the
 * derived list of event/place handles) is what keeps it short and keeps a
 * stale link honest: the handles are re-derived from the caches on arrival,
 * so a link still shows the truth after the subject has been edited. */
export interface VisualSubject {
  /** A VIEWS key -- one of SUBJECT_KEYS. */
  type: string;
  handle: string;
}

/** The types a visual can be scoped to. Person and Family are the ones with
 * a list of events to plot; Event and Place are single records that a visual
 * locates in context rather than filters down to (see the visuals' own
 * default-mode tables). Everything else has nothing on either axis. */
export const SUBJECT_KEYS = ["person", "family", "event", "place"] as const;

export function isSubjectKey(key: string): boolean {
  return (SUBJECT_KEYS as readonly string[]).includes(key);
}

/** "person:a5af0eb667015e355db" <-> {type, handle}. One segment rather than
 * two so a subject stays distinguishable from the plain `#/<view>/<handle>`
 * form parsed above it, and so a later multi-subject route can just
 * comma-join these without the grammar changing. A Gramps handle is
 * alphanumeric only, so the colon is unambiguous. */
function parseSubject(token: string | undefined): VisualSubject | null {
  if (!token) return null;
  const colon = token.indexOf(":");
  if (colon <= 0) return null;
  const type = token.slice(0, colon);
  const handle = token.slice(colon + 1);
  if (!handle || !isSubjectKey(type)) return null;
  return { type, handle };
}

function formatSubject(subject: VisualSubject): string {
  return `${subject.type}:${subject.handle}`;
}

/** The visual pages (View > Map, View > Timeline, View > Tree, View >
 * Search all), which occupy the same slot in a route as an object type's
 * key even though they aren't VIEWS entries: they have no table, no
 * selection and no store of their own, so there's nothing for a ViewConfig
 * to configure. Routed rather than held in component state so they behave
 * like every other page here -- Back steps out of one, a reload lands back
 * on it, and anything that wants to send the user to one (RelatedPanel's
 * Map/Timeline/Tree buttons) only has to set the hash. Map and Timeline
 * plot every record of two types at once by default and one record's slice
 * of it when the route carries a VisualSubject; Tree has no such default --
 * a VisualSubject (or a pick made on arrival) is what it's rooted on,
 * always. Search never takes a VisualSubject -- it's a query box over the
 * server's own full-text index (SearchView.tsx), not a plot of anything
 * already in the local cache. */
export const VISUAL_KEYS = ["map", "timeline", "tree", "search"] as const;
export type VisualKey = (typeof VISUAL_KEYS)[number];

export function isVisualKey(key: string): key is VisualKey {
  return (VISUAL_KEYS as readonly string[]).includes(key);
}

/** The dashboard page (App.tsx's HomeView) -- like a visual, it takes over
 * the whole content area and has no ViewConfig/store of its own, but unlike
 * one it never carries a subject: it's a single, unscoped overview. */
export const HOME_KEY = "home";

export function isHomeKey(key: string): boolean {
  return key === HOME_KEY;
}

/** Every route key that names a page rather than a VIEWS entry -- the ones
 * with no ViewStore to select a row in or wait on (useHistorySync.ts) and
 * no per-view load to kick off (App.tsx's ensureLoaded effect). */
export function isStorelessKey(key: string): boolean {
  return isVisualKey(key) || isHomeKey(key);
}

/** Parses "#/<viewKey>", "#/<viewKey>/<handle>", "#/home", or a visual's
 * "#/<visualKey>/<type>:<handle>" (also tolerates a missing leading slash,
 * or no hash at all). An unrecognized/missing view key falls back to Home
 * rather than erroring -- a fresh load, or a stale/hand-edited URL, should
 * still land somewhere sane, and by the same rule an unparseable subject
 * degrades to the unscoped whole-tree visual rather than to no page at all.
 * A visual still has no selection to restore, so it never carries a plain
 * `handle`; neither does Home. */
export function parseHash(hash: string = window.location.hash): HashRoute {
  const parts = hash.slice(1).split("/").filter(Boolean);
  const [viewKey, handle] = parts;
  if (viewKey && isVisualKey(viewKey)) {
    return { viewKey, handle: null, subject: parseSubject(handle) };
  }
  if (!viewKey || isHomeKey(viewKey)) {
    return { viewKey: HOME_KEY, handle: null, subject: null };
  }
  if (!VIEWS.some((v) => v.key === viewKey)) {
    return { viewKey: HOME_KEY, handle: null, subject: null };
  }
  return { viewKey, handle: handle ?? null, subject: null };
}

export function formatHash(route: Partial<HashRoute> & { viewKey: string }): string {
  if (isVisualKey(route.viewKey)) {
    return route.subject
      ? `#/${route.viewKey}/${formatSubject(route.subject)}`
      : `#/${route.viewKey}`;
  }
  return route.handle ? `#/${route.viewKey}/${route.handle}` : `#/${route.viewKey}`;
}
