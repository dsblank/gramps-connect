import { useSyncExternalStore } from "react";
import type { ViewSnapshot } from "../store/viewStore";
import { getViewStore } from "../store/registry";

/** Subscribes to one view's store, re-rendering only when its snapshot
 * (loadedCount/totalCount/whereExpr/status/error) actually changes -- row
 * data itself is read separately and imperatively (see DataTable.tsx),
 * not through this hook. */
export function useViewStore(viewKey: string): ViewSnapshot {
  const store = getViewStore(viewKey);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
