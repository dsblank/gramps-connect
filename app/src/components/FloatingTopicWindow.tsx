import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Box, Group, Loader, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { getToken } from "../auth/auth";
import { formatHash } from "../hash";
import { fetchObjectExtended, getBacklinks, type ObjectDetail } from "../store/objectDetail";
import { parseTopicSpec } from "../store/topicsApi";
import { closeTopicWindow, getTopicActivityVersion, subscribeTopicActivity, toggleMinimizeTopicWindow } from "../store/topicWindows";
import { TOPICS_VIEW } from "../store/views";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { LinkObjectControl } from "./related/LinkObjectControl";
import { TopicLinksSection } from "./related/TopicLinksSection";
import { TopicThread } from "./related/TopicThread";
import { t } from "../i18n/i18n";

// Exported so FloatingTopicWindows.tsx can compute each card's independent
// `rightOffset` from these -- see this component's own doc comment for why
// positioning is independent per card rather than a shared flex row.
export const CARD_WIDTH = 320;
export const CARD_GAP = 12;
export const VIEWPORT_MARGIN = 16;

/** A click on a linked object inside a floating window promotes straight
 * to a real view switch -- there's no aside/reference-detail pane inside a
 * small floating card to preview into the way RelatedPanel's own onNavigate
 * implementations do, so this is the same plain hash assignment
 * ReferenceDetail's onPromote uses. */
function navigateAway(type: string, handle: string): void {
  window.location.hash = formatHash({ viewKey: type, handle });
}

/** One floating chat window -- a Messenger-style chat head rather than a
 * mode of RelatedPanel's shared detail pane, so it stays open and usable
 * while the rest of the app is navigated underneath it. Owns its own
 * detail fetch (title/description/linked objects) independent of any
 * ViewStore selection, refetching on topicWindows.ts's activity counter
 * (a live-sync notification for *any* note -- see App.tsx's
 * onRemoteNoteChange) and its own `refetchNonce` (after this window's own
 * link/unlink actions -- renaming/describing a topic only happens from its
 * management page now, RelatedPanel.tsx's own "topics" branch, not here).
 *
 * `rightOffset` positions this card with its own independent
 * `position: fixed` (see FloatingTopicWindows.tsx) rather than as a child
 * in a shared flex row: a flex row's `wrap`/alignment has to account for
 * every sibling's current height, which is exactly what made a
 * minimize/expand toggle occasionally land a card in the wrong slot when
 * mixed expanded (~400px) and minimized (~40px) heights were in the same
 * row (confirmed live). An independently positioned card can never affect
 * -- or be affected by -- any other card's height. */
export function FloatingTopicWindow({ handle, minimized, rightOffset }: { handle: string; minimized: boolean; rightOffset: number }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: ObjectDetail }>({ status: "loading" });
  const [refetchNonce, setRefetchNonce] = useState(0);
  const [linksOpen, setLinksOpen] = useState(false);
  const activityVersion = useSyncExternalStore(subscribeTopicActivity, getTopicActivityVersion);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const detail = await fetchObjectExtended(token, TOPICS_VIEW, handle);
        if (!cancelled) setState({ status: "ready", detail });
      } catch (err: any) {
        if (!cancelled) setState({ status: "error", message: err.message ?? String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, activityVersion, refetchNonce]);

  const spec = state.status === "ready" ? parseTopicSpec((state.detail.text as { string?: string } | undefined)?.string) : null;
  const title = spec?.title ?? t("Discussion");
  const linkCount = state.status === "ready"
    ? Object.values(getBacklinks(state.detail)).reduce((n, items) => n + items.length, 0)
    : 0;

  return (
    <Paper
      withBorder
      shadow="md"
      radius="sm"
      style={{
        position: "fixed",
        bottom: 0,
        right: rightOffset,
        width: CARD_WIDTH,
        maxHeight: "calc(100vh - 32px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 300,
      }}
    >
      <Group
        gap={6}
        wrap="nowrap"
        justify="space-between"
        px="sm"
        py={6}
        style={{ flex: "none", background: "var(--mantine-color-default-hover)", borderBottom: minimized ? undefined : "1px solid var(--mantine-color-default-border)" }}
      >
        <UnstyledButton onClick={() => toggleMinimizeTopicWindow(handle)} style={{ minWidth: 0, flex: 1 }}>
          <Text fw={600} size="sm" truncate>{title}</Text>
        </UnstyledButton>
        <Group gap={2} wrap="nowrap">
          <CircleGlyphButton
            glyph={minimized ? "▴" : "▾"}
            label={minimized ? t("Expand") : t("Minimize")}
            onClick={() => toggleMinimizeTopicWindow(handle)}
            size={18}
          />
          <CircleGlyphButton glyph="×" label={t("Close")} onClick={() => closeTopicWindow(handle)} size={18} />
        </Group>
      </Group>
      {!minimized && (
        <Box p="sm" style={{ overflowY: "auto" }}>
          {state.status === "loading" && (
            <Group justify="center" py="md"><Loader size="sm" /></Group>
          )}
          {state.status === "error" && <Alert color="red">{state.message}</Alert>}
          {state.status === "ready" && (
            <Stack gap="sm">
              {spec?.description && <Text size="sm" c="dimmed">{spec.description}</Text>}
              {spec?.participants && spec.participants.length > 0 && (
                <Text size="xs" c="dimmed">{t("With")}: {spec.participants.join(", ")}</Text>
              )}
              <TopicThread topicHandle={handle} historyHeight={240} />
              <UnstyledButton onClick={() => setLinksOpen((open) => !open)}>
                <Text size="xs" c="dimmed" fw={600}>
                  {linksOpen ? "▾" : "▴"} {t("Linked objects")} ({linkCount})
                </Text>
              </UnstyledButton>
              {linksOpen && (
                <>
                  <LinkObjectControl topicHandle={handle} onLinked={() => setRefetchNonce((n) => n + 1)} />
                  <TopicLinksSection detail={state.detail} onNavigate={navigateAway} onRefetch={() => setRefetchNonce((n) => n + 1)} />
                </>
              )}
            </Stack>
          )}
        </Box>
      )}
    </Paper>
  );
}
