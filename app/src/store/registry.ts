// One ViewStore per VIEWS entry, sharing a single lazily-initialized
// sql.js WASM module -- mirrors the original spike's single `SQL =
// await initSqlJs(...)` in main(), just deferred until first use instead
// of blocking app startup.
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { VIEWS } from "./views";
import { ViewStore } from "./viewStore";

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: (file) => `/${file}` });
  }
  return sqlPromise;
}

const stores = new Map<string, ViewStore>(VIEWS.map((view) => [view.key, new ViewStore(view, getSql)]));

export function getViewStore(key: string): ViewStore {
  const store = stores.get(key);
  if (!store) throw new Error(`no such view: ${key}`);
  return store;
}

export function allViewStores(): ViewStore[] {
  return VIEWS.map((view) => stores.get(view.key)!);
}
