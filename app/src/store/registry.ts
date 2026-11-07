// One ViewStore per VIEWS entry, sharing a single lazily-initialized
// sql.js WASM module -- mirrors the original spike's single `SQL =
// await initSqlJs(...)` in main(), just deferred until first use instead
// of blocking app startup.
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { VIEWS } from "./views";
import { ViewStore } from "./viewStore";
import { attachDisplayStores } from "./placeIndex";

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: (file) => `/${file}` });
  }
  return sqlPromise;
}

const stores = new Map<string, ViewStore>(VIEWS.map((view) => [view.key, new ViewStore(view, getSql)]));
attachDisplayStores({ place: stores.get("place")!, event: stores.get("event")! });

// Dev only: a hot update that re-runs this module (an edit here, or in
// anything it imports -- placeIndex.ts, views.ts, viewStore.ts...) would
// create a second, empty set of stores and attach placeIndex.ts to them,
// while the mounted app and live sync keep using the first set: automatic
// place titles then stop following edits until a reload. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

// Grouped by ViewConfig.table (defaulting to `key`) rather than by `key`
// itself -- more than one view can watch the same underlying object type
// (e.g. "media" and "generated" both back onto Media), so a live-sync
// notification for that type needs to reach every view backed by it, not
// just whichever one happens to share its key. See useLiveSync.ts.
const storesByTable = new Map<string, ViewStore[]>();
for (const view of VIEWS) {
  const table = view.table ?? view.key;
  const list = storesByTable.get(table) ?? [];
  list.push(stores.get(view.key)!);
  storesByTable.set(table, list);
}

export function getViewStore(key: string): ViewStore {
  const store = stores.get(key);
  if (!store) throw new Error(`no such view: ${key}`);
  return store;
}

export function getViewStoresForTable(table: string): ViewStore[] {
  return storesByTable.get(table) ?? [];
}

export function allViewStores(): ViewStore[] {
  return VIEWS.map((view) => stores.get(view.key)!);
}
