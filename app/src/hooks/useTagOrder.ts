import { useEffect, useState } from "react";
import { getToken } from "../auth/auth";
import { fetchTagRecords, orderTagHandles, type TagRecord } from "../store/tagOrder";

/** Puts a record's tag handles in priority order (orderTagHandles) for
 * an editor's Tags list. Fetches the tree's tags once per edit `session`,
 * and only when `enabled` (a dialog with a Tags field). Until they load,
 * or if they can't be, the handles keep their stored order. */
export function useTagOrder(enabled: boolean, session: number): (handles: string[]) => string[] {
  const [tags, setTags] = useState<Map<string, TagRecord> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const records = await fetchTagRecords(await getToken());
        if (!cancelled) setTags(new Map(records.map((r) => [r.handle, r])));
      } catch {
        // Stored order is a fine fallback for a display-only nicety.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, session]);
  return (handles) => (tags ? orderTagHandles(handles, tags) : handles);
}
