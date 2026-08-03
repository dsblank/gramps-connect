import { useViewStore } from "../hooks/useViewStore";
import { clearOpfs } from "../store/opfs";
import type { ViewConfig } from "../store/views";
import type { LiveSyncStatus } from "../hooks/useLiveSync";

interface StatusBarProps {
  view: ViewConfig;
  liveSyncStatus: LiveSyncStatus;
}

export function StatusBar({ view, liveSyncStatus }: StatusBarProps) {
  const snapshot = useViewStore(view.key);

  async function handleClearCache() {
    await clearOpfs(view.opfsFilename);
    window.location.reload();
  }

  return (
    <div className="status-bar">
      <span className="load-status">
        {snapshot.totalCount > 0
          ? `loaded ${snapshot.loadedCount.toLocaleString()} / ${snapshot.totalCount.toLocaleString()}`
          : snapshot.status === "loading"
          ? "loading…"
          : ""}
      </span>
      {snapshot.status === "error" && <span className="load-error">{snapshot.error}</span>}
      <span className={`live-sync-status live-sync-status--${liveSyncStatus}`}>
        live sync: {liveSyncStatus}
      </span>
      <button onClick={handleClearCache}>Clear OPFS cache (force re-fetch)</button>
    </div>
  );
}
