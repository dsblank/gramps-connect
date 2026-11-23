import { Group, Text, Badge } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import type { ViewSnapshot } from "../store/viewStore";
import { VIEWS, type ViewConfig } from "../store/views";
import type { LiveSyncStatus } from "../hooks/useLiveSync";

interface StatusBarProps {
  /** Null on a page with no ViewStore of its own -- Home (see hash.ts's
   * isStorelessKey) -- where there's no per-view load progress to report,
   * just the live-sync badge. */
  view: ViewConfig | null;
  liveSyncStatus: LiveSyncStatus;
}

const LIVE_SYNC_COLOR: Record<LiveSyncStatus, string> = {
  connected: "green",
  connecting: "yellow",
  disconnected: "red",
};

/** "loaded x / y" while rows are still arriving; once the whole list is
 * in, "showing x / TOTAL" -- the rows in the (possibly filtered) list out
 * of the tree's whole count. TOTAL is unknown when the list was filtered
 * from its very first load (no whole-tree copy was kept, see
 * viewStore.hasWholeTreeRows), so it's left off then. */
function listCountText(key: ViewConfig["key"], snapshot: ViewSnapshot): string {
  const { loadedCount, totalCount, status } = snapshot;
  if (status === "loading" && totalCount === 0) return "loading…";
  if (loadedCount < totalCount) {
    return `loaded ${loadedCount.toLocaleString()} / ${totalCount.toLocaleString()}`;
  }
  if (status !== "ready") return "";
  const filtered = snapshot.whereExpr !== null || snapshot.pickerExpr !== null;
  if (!filtered) return totalCount > 0 ? `showing ${totalCount.toLocaleString()} / ${totalCount.toLocaleString()}` : "";
  const store = getViewStore(key);
  if (!store.hasWholeTreeRows()) return `showing ${totalCount.toLocaleString()}`;
  return `showing ${totalCount.toLocaleString()} / ${store.unfilteredCounts().total.toLocaleString()}`;
}

export function StatusBar({ view, liveSyncStatus }: StatusBarProps) {
  // The hook can't be called conditionally -- read some view's snapshot
  // unconditionally and simply don't render it below when there's no real
  // `view` to attribute it to.
  const snapshot = useViewStore((view ?? VIEWS[0]).key);
  const countText = view ? listCountText(view.key, snapshot) : "";

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="md" wrap="nowrap">
        {view && (
          <Text size="xs" c="dimmed">
            {countText}
          </Text>
        )}
        {view && snapshot.status === "error" && (
          <Text size="xs" c="red">{snapshot.error}</Text>
        )}
      </Group>
      <Group gap="md" wrap="nowrap">
        {/* No manual "clear cache" escape hatch alongside this: a stale
            OPFS cache is now detected and dropped on load (see
            store/cacheMeta.ts), so there's nothing left for the button to
            fix that a reload doesn't already do. */}
        <Badge size="sm" variant="dot" color={LIVE_SYNC_COLOR[liveSyncStatus]}>
          live sync: {liveSyncStatus}
        </Badge>
      </Group>
    </Group>
  );
}
