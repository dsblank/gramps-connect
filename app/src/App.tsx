import { useEffect, useSyncExternalStore } from "react";
import { AppShell, Box, Group, Image, Stack, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { EVENT_VIEW, PLACE_VIEW, VIEWS, type ViewConfig } from "./store/views";
import { getViewStore } from "./store/registry";
import { isVisualKey, type VisualKey } from "./hash";
import { getAuthSnapshot, subscribe as subscribeAuth } from "./auth/auth";
import { LoginForm } from "./auth/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { MenuBar } from "./components/MenuBar";
import { UserMenu } from "./components/UserMenu";
import { FilterBar } from "./components/FilterBar";
import { MessageComposer } from "./components/MessageComposer";
import { DataTable } from "./components/DataTable";
import { AsideSplit } from "./components/AsideSplit";
import { StatusBar } from "./components/StatusBar";
import { MapView } from "./components/visuals/MapView";
import { TimelineView } from "./components/visuals/TimelineView";
import { useHistorySync } from "./hooks/useHistorySync";
import { useLiveSync } from "./hooks/useLiveSync";
import type { TreeChangeNotification } from "./store/historyPoll";
import { startCatchupSweep } from "./store/jobsPoll";
import { jobsPollCallbacks } from "./store/jobsCallbacks";
import { notifyBrowser } from "./store/browserNotifications";
import logo from "./assets/icons/gramps-logo.svg";

export function App() {
  const loggedIn = useSyncExternalStore(subscribeAuth, getAuthSnapshot);
  return loggedIn ? <AuthenticatedApp /> : <LoginForm />;
}

/** Toast for a Notes-table change by someone else, per useLiveSync's
 * onRemoteNoteChange -- same notifications.show + notifyBrowser shape as
 * jobsPollCallbacks above. changedBy is non-null whenever this fires (see
 * useLiveSync's own guard). */
const NOTE_OP_VERB: Record<TreeChangeNotification["op"], string> = {
  INSERT: "made",
  UPDATE: "made",
  DELETE: "deleted",
};

function onRemoteNoteChange(notification: TreeChangeNotification) {
  const title = "Gramps Connect message";
  const message = `User ${notification.changedBy} ${NOTE_OP_VERB[notification.op]} a message`;
  notifications.show({ color: "blue", title, message });
  notifyBrowser(title, message);
}

/** Mantine's `sm` breakpoint, spelled as a raw media query because media
 * queries can't read `var(--mantine-breakpoint-sm)`. DataTable.module.css
 * carries the same 48em in its own @media block -- keep the two in sync. */
const STACKED_QUERY = "(max-width: 48em)";

/** One header row, or two with the menu bar on its own. AppShell needs the
 * height as a number either way -- it's what Main, the navbar and the
 * aside are all offset by -- so the header can't just grow to fit its
 * content. */
const HEADER_HEIGHT = 56;
const HEADER_HEIGHT_STACKED = 96;
const FOOTER_HEIGHT = 36;

/** Which store the footer's load progress follows while a visual page is
 * open. A visual has no store of its own (see hash.ts's VISUAL_KEYS), but
 * it is drawn from these caches, so the footer keeps saying how much of the
 * relevant one has arrived -- which is exactly the caveat the visual's own
 * status strip is disclosing at the same time. */
const VISUAL_STATUS_VIEW: Record<VisualKey, ViewConfig> = {
  map: PLACE_VIEW,
  timeline: EVENT_VIEW,
};

function AuthenticatedApp() {
  const { activeKey, setActiveKey, visualSubject } = useHistorySync();
  const liveSyncStatus = useLiveSync(onRemoteNoteChange);
  // #/map and #/timeline are pages in their own right rather than VIEWS
  // entries -- each takes over the whole content area (table *and* detail
  // panes) for one whole-tree plot; see hash.ts.
  const visualKey = isVisualKey(activeKey) ? activeKey : null;
  // `view` is null on a visual page -- the table, the panes and the filter
  // bar all key off it, and none of them belong there. `statusView` is the
  // one thing that still needs a ViewConfig either way (see above).
  const statusView = visualKey ? VISUAL_STATUS_VIEW[visualKey] : VIEWS.find((v) => v.key === activeKey)!;
  const view = visualKey ? null : statusView;

  // Narrow window: there's no room left for the 50/50 side-by-side split,
  // so the detail panes move *under* the table inside Main instead. Read
  // straight from matchMedia on the first render (rather than Mantine's
  // default of settling it in an effect) so a narrow load doesn't briefly
  // mount AsideSplit in the aside -- that flash would fire the selected
  // record's whole detail fetch just to unmount it a tick later.
  const stacked = useMediaQuery(STACKED_QUERY, false, { getInitialValueInEffect: false });

  // A visual page fills the window exactly: both plots measure themselves
  // against their frame (the timeline off a ResizeObserver, the map off
  // maplibre's), so it needs a real bounded height rather than one that
  // grows to fit content -- and a map that ends halfway down a scrollable
  // page is the thing this move away from a dialog is meant to stop.
  // Budgeted against Main's own md padding on both edges, plus the footer:
  // docked beneath Main when there's width for it, in flow at the end of
  // Main (so inside this height, with its own md margin above) when there
  // isn't.
  const visualHeight = stacked
    ? `calc(100dvh - ${HEADER_HEIGHT_STACKED + FOOTER_HEIGHT}px - var(--mantine-spacing-md) * 3)`
    : `calc(100dvh - ${HEADER_HEIGHT + FOOTER_HEIGHT}px - var(--mantine-spacing-md) * 2)`;

  // Same left-hand block in both header layouts below, differing only in
  // what sits next to it.
  const wordmark = (
    <Group gap="xs" wrap="nowrap">
      <Image src={logo} alt="" w={32} h={32} />
      <Title order={4} fw={600}>Gramps Connect</Title>
    </Group>
  );

  // Lazy per-view load, same as the original spike's ensureViewLoaded()
  // call in selectView() -- a no-op if this view was already loaded
  // earlier this session.
  // A visual page has no store to load here -- it reads the Places and
  // Events caches, which useVisualData loads for itself.
  useEffect(() => {
    if (isVisualKey(activeKey)) return;
    getViewStore(activeKey).ensureLoaded().catch((err) => {
      console.error(`[${activeKey}] failed to load`, err);
    });
  }, [activeKey]);

  // Server-driven catch-up sweep for reports/exports whose dispatching tab
  // is gone -- see jobsPoll.ts's startCatchupSweep. Mounted once for the
  // whole authenticated app, same lifetime as useLiveSync() above.
  useEffect(() => {
    return startCatchupSweep(jobsPollCallbacks);
  }, []);

  return (
    <AppShell
      header={{ height: stacked ? HEADER_HEIGHT_STACKED : HEADER_HEIGHT }}
      // breakpoint 0 on both = never let AppShell switch them into its own
      // "mobile" mode, where a navbar/aside becomes 100% wide, drops its
      // Main offset, and so covers the content outright (position: fixed).
      // That's exactly what used to hide the table on a narrow window: the
      // aside painted over the whole of Main. Narrow is handled by
      // `stacked` below instead -- the icon rail just stays a rail, and
      // the aside is dropped rather than overlaid.
      navbar={{ width: 68, breakpoint: 0 }}
      // No aside on a visual page either: a map of every place at once
      // isn't another way of looking at one selected record, so there's
      // nothing for the detail panes to show beside it, and the plot wants
      // the width. Clicking a marker or a dot navigates to that record in
      // Places or Events, where they take over again.
      aside={stacked || visualKey ? undefined : { width: "50%", breakpoint: 0 }}
      // Stacked: no docked footer either. A permanently pinned 36px strip
      // is a poor trade for vertical space that's already scarce, and it's
      // what pane 3 was ending up jammed against -- the same StatusBar
      // renders at the end of Main instead, scrolling in when wanted.
      footer={stacked ? undefined : { height: FOOTER_HEIGHT }}
      padding="md"
    >
      <AppShell.Header>
        {stacked ? (
          // Two rows. Side by side, the wordmark + seven menus + avatar
          // stop fitting somewhere around 650px, and a Group answers that
          // by wrapping -- straight down through the header's fixed height
          // and behind the search box below it. Give the bar a row of its
          // own instead (HEADER_HEIGHT_STACKED covers both).
          <Stack gap={0} h="100%">
            <Group h={HEADER_HEIGHT} px="md" justify="space-between" wrap="nowrap">
              {wordmark}
              <UserMenu />
            </Group>
            {/* Seven menus still outgrow a phone-width row, so that row
                scrolls sideways -- MenuBar itself never wraps. */}
            <Box
              px="md"
              style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", overflowX: "auto" }}
            >
              <MenuBar />
            </Box>
          </Stack>
        ) : (
          <Group h="100%" px="md" justify="space-between" wrap="nowrap">
            <Group gap="lg" wrap="nowrap">
              {wordmark}
              <MenuBar />
            </Group>
            <UserMenu />
          </Group>
        )}
      </AppShell.Header>

      <AppShell.Navbar>
        <Sidebar activeKey={activeKey} onSelect={setActiveKey} />
      </AppShell.Navbar>

      <AppShell.Main>
        {/* A visual page instead of the table and its panes -- one plot,
            the height of the window (see visualHeight above), with the
            footer below it as usual. Mounted only while it's the active
            route: each holds a derived copy of a few thousand rows, and the
            map a live WebGL context, so leaving one shouldn't leave that
            sitting in the tree. */}
        {visualKey === "map" && <Box style={{ height: visualHeight }}><MapView subject={visualSubject} /></Box>}
        {visualKey === "timeline" && (
          <Box style={{ height: visualHeight }}><TimelineView subject={visualSubject} /></Box>
        )}
        {/* Keyed by view.key so switching views remounts fresh local state
            (filter input/error, scroll position) rather than carrying it
            over from the previous view. Prefixed distinctly per element --
            React requires keys to be unique only among *siblings*, and
            these two are both direct children of the same fragment; reusing
            the bare view.key for both produced a real bug (a "duplicate
            key" warning, and FilterBar instances piling up instead of
            unmounting) caught by an end-to-end smoke test. */}
        {view && <FilterBar key={`filter-${view.key}`} view={view} />}
        {view?.key === "messages" && <MessageComposer key={`compose-${view.key}`} />}
        {view && <DataTable key={`table-${view.key}`} view={view} />}
        {/* Stacked layout only -- the same panes the aside holds when
            there's width for it, but in `flow` mode: no height of their
            own, no scrollbars of their own, just as tall as their content
            needs with the page carrying all of it. Bordered to match the
            table above it, since inside Main they no longer have the
            aside's own edge to separate them. */}
        {stacked && view && (
          <Box
            mt="md"
            style={{ border: "1px solid var(--mantine-color-default-border)" }}
          >
            <AsideSplit key={`detail-${view.key}`} view={view} flow />
          </Box>
        )}
        {/* In flow rather than docked (see the footer config above), and
            bled back out through Main's padding so it still reads as the
            same full-width strip. It ends up at the foot of a page as long
            as the panes make it, which is the trade being made: load
            progress and sync state stop occupying 36px of a narrow
            viewport permanently, and are read by scrolling to the end. */}
        {stacked && (
          <Box
            style={{
              height: FOOTER_HEIGHT,
              marginTop: "var(--mantine-spacing-md)",
              marginInline: "calc(var(--mantine-spacing-md) * -1)",
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            <StatusBar view={statusView} liveSyncStatus={liveSyncStatus} />
          </Box>
        )}
      </AppShell.Main>

      {!stacked && view && (
        <AppShell.Aside>
          <AsideSplit key={`detail-${view.key}`} view={view} />
        </AppShell.Aside>
      )}

      {!stacked && (
        <AppShell.Footer>
          <StatusBar view={statusView} liveSyncStatus={liveSyncStatus} />
        </AppShell.Footer>
      )}
    </AppShell>
  );
}
