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
}

/** Parses "#/<viewKey>" or "#/<viewKey>/<handle>" (also tolerates a
 * missing leading slash, or no hash at all). An unrecognized/missing view
 * key falls back to the first view rather than erroring -- a stale or
 * hand-edited URL should still land somewhere sane. */
export function parseHash(hash: string = window.location.hash): HashRoute {
  const parts = hash.slice(1).split("/").filter(Boolean);
  const [viewKey, handle] = parts;
  const resolvedKey = VIEWS.some((v) => v.key === viewKey) ? viewKey : VIEWS[0].key;
  return { viewKey: resolvedKey, handle: handle ?? null };
}

export function formatHash(route: HashRoute): string {
  return route.handle ? `#/${route.viewKey}/${route.handle}` : `#/${route.viewKey}`;
}
