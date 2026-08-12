import { Group, Text, Badge } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import type { ViewConfig } from "../store/views";
import type { LiveSyncStatus } from "../hooks/useLiveSync";

interface StatusBarProps {
  view: ViewConfig;
  liveSyncStatus: LiveSyncStatus;
}

const LIVE_SYNC_COLOR: Record<LiveSyncStatus, string> = {
  connected: "green",
  connecting: "yellow",
  disconnected: "red",
};

export function StatusBar({ view, liveSyncStatus }: StatusBarProps) {
  const snapshot = useViewStore(view.key);

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="md" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {snapshot.totalCount > 0
            ? `loaded ${snapshot.loadedCount.toLocaleString()} / ${snapshot.totalCount.toLocaleString()}`
            : snapshot.status === "loading"
            ? "loading…"
            : ""}
        </Text>
        {snapshot.status === "error" && (
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
