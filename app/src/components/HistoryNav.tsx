import { useEffect, useSyncExternalStore } from "react";
import { ActionIcon, Group, Tooltip } from "@mantine/core";
import {
  getNavHistorySnapshot,
  goBack,
  goForward,
  installNavHistory,
  subscribeNavHistory,
} from "../store/navHistory";
import { t } from "../i18n/i18n";

/** The header's Back/Forward pair, on every page. Mostly for the desktop
 * app, whose window has no browser toolbar; in a browser they do exactly
 * what its own buttons do, except that Back stops at the first page of
 * the app instead of leaving it (see store/navHistory.ts). */
export function HistoryNav() {
  useEffect(() => installNavHistory(), []);
  const { canGoBack, canGoForward } = useSyncExternalStore(subscribeNavHistory, getNavHistorySnapshot);
  return (
    <Group gap={2} wrap="nowrap">
      <Tooltip label={t("Back")} openDelay={400}>
        <ActionIcon variant="subtle" color="gray" onClick={goBack} disabled={!canGoBack} aria-label={t("Back")}>
          <Chevron direction="left" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("Forward")} openDelay={400}>
        <ActionIcon variant="subtle" color="gray" onClick={goForward} disabled={!canGoForward} aria-label={t("Forward")}>
          <Chevron direction="right" />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={direction === "left" ? "15 6 9 12 15 18" : "9 6 15 12 9 18"} />
    </svg>
  );
}
