import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppShell, Box, Group, Image, Stack, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { EVENT_VIEW, PLACE_VIEW, VIEWS, type ViewConfig } from "./store/views";
import { getViewStore } from "./store/registry";
import { HOME_KEY, isStorelessKey, isVisualKey, type VisualKey } from "./hash";
import { getAuthSnapshot, subscribe as subscribeAuth } from "./auth/auth";
import { getI18nSnapshot, setLanguage, subscribe as subscribeI18n, t } from "./i18n/i18n";
import { LoginForm } from "./auth/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { HomeView } from "./components/HomeView";
import { MenuBar } from "./components/MenuBar";
import { UserMenu } from "./components/UserMenu";
import { FilterBar } from "./components/FilterBar";
import { ListHeader } from "./components/ListHeader";
import { DataTable } from "./components/DataTable";
import { AsideSplit } from "./components/AsideSplit";
import { StatusBar } from "./components/StatusBar";
import { MapView } from "./components/visuals/MapView";
import { TimelineView } from "./components/visuals/TimelineView";
import { TreeView } from "./components/visuals/TreeView";
import { SearchView } from "./components/visuals/SearchView";
import { useHistorySync } from "./hooks/useHistorySync";
import { useLiveSync } from "./hooks/useLiveSync";
import type { TreeChangeNotification } from "./store/historyPoll";
import { startCatchupSweep } from "./store/jobsPoll";
import { loadUserDirectory } from "./store/userDirectory";
import { jobsPollCallbacks } from "./store/jobsCallbacks";
import { notifyBrowser } from "./store/browserNotifications";
import { useDraftStack } from "./store/draftStack";
import { EditDialogs } from "./components/EditDialogs";
import { useMediaDrop } from "./hooks/useMediaDrop";
import { MediaDropOverlay } from "./components/MediaDropOverlay";
import { PyodidePocPanel } from "./pyodidePoc/PyodidePocPanel";
import { OBJECT_QUERY_ENDPOINTS } from "./pyodidePoc/objectEndpoints";
import logo from "./assets/icons/gramps-connect-logo.svg";

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
const NAVBAR_WIDTH = 68;

/** Persisted drag widths for the Main/Aside divider, one per view.key
 * (App.tsx's own analog of columnWidths.ts, which is likewise per-view). A
 * key missing from the map means "no drag yet on this view, follow the
 * default 50% split" -- same as before this was resizable at all. Keyed
 * because Person's detail pane wants a lot more room than, say, Repository's
 * -- a single shared width would fight between views instead of remembering
 * what each one actually needs. Only a completed drag ever writes an entry;
 * the 50% default is never itself persisted, so an update that changes it
 * keeps applying to any view nobody's dragged yet. */
const ASIDE_WIDTHS_KEY = "gramps-connect_aside_widths";
const MIN_ASIDE_WIDTH = 320;
/** However wide the aside gets dragged, Main (past the navbar rail) keeps at
 * least this much room -- the table stops being usable well before its
 * columns actually run out of space to shrink into. */
const MIN_MAIN_WIDTH = 360;

function readStoredAsideWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ASIDE_WIDTHS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const widths: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) widths[key] = value;
    }
    return widths;
  } catch {
    return {};
  }
}

function writeStoredAsideWidths(widths: Record<string, number>) {
  try {
    localStorage.setItem(ASIDE_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // Storage unavailable (private browsing etc.) -- the widths still work
    // for this session, they just won't survive a reload.
  }
}

function maxAsideWidth(): number {
  return Math.max(window.innerWidth - NAVBAR_WIDTH - MIN_MAIN_WIDTH, MIN_ASIDE_WIDTH);
}

/** Which store the footer's load progress follows while a visual page is
 * open. A visual has no store of its own (see hash.ts's VISUAL_KEYS), but
 * Map/Timeline are drawn from these caches, so the footer keeps saying how
 * much of the relevant one has arrived -- which is exactly the caveat each
 * visual's own status strip is disclosing at the same time. Tree has no
 * entry: its data is one network fetch per open, not a background-filling
 * local cache, so there's no load progress for the footer to add to what
 * VisualFrame's own loading state already says. */
const VISUAL_STATUS_VIEW: Partial<Record<VisualKey, ViewConfig>> = {
  map: PLACE_VIEW,
  timeline: EVENT_VIEW,
};

function AuthenticatedApp() {
  // Re-renders the whole tree on a language change -- t() elsewhere is a
  // plain synchronous lookup, so one subscription here (same coarse-grained
  // approach as the loggedIn gate in App()) is enough; no per-component
  // subscription needed.
  const { lang } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  useEffect(() => {
    // Module state seeds `lang` from storage at import time but not
    // `strings` -- populate it once on mount for a persisted non-English
    // choice. A no-op for "en", and safe to call again on a real language
    // change (setLanguage is what drives `lang` after that).
    if (lang !== "en") setLanguage(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { activeKey, setActiveKey, visualSubject } = useHistorySync();
  const liveSyncStatus = useLiveSync(onRemoteNoteChange);
  // Lifted above MenuBar (rather than MenuBar calling this itself) because
  // the header below swaps between two MenuBar instances on resize --
  // stacked vs. side-by-side -- and only one is ever mounted at a time.
  // State owned by MenuBar itself would vanish (mid-edit!) on a resize that
  // crosses STACKED_QUERY's breakpoint; state owned here survives it.
  const draftStack = useDraftStack();
  const mediaDrop = useMediaDrop(draftStack, activeKey);
  // #/map and #/timeline are pages in their own right rather than VIEWS
  // entries -- each takes over the whole content area (table *and* detail
  // panes) for one whole-tree plot; see hash.ts. #/home is the same idea
  // with nothing to plot: a dashboard, not a per-record page.
  const visualKey = isVisualKey(activeKey) ? activeKey : null;
  const isHome = activeKey === HOME_KEY;
  // `view` is null on a visual or Home page -- the table, the panes and the
  // filter bar all key off it, and none of them belong there. `statusView`
  // is null only for Home: a visual still has a ViewConfig to report load
  // progress for (see VISUAL_STATUS_VIEW), but Home has no single view's
  // progress to show, just the live-sync badge.
  const statusView = visualKey
    ? VISUAL_STATUS_VIEW[visualKey] ?? null
    : isHome
    ? null
    : VIEWS.find((v) => v.key === activeKey)!;
  const view = visualKey || isHome ? null : statusView;

  // Narrow window: there's no room left for the 50/50 side-by-side split,
  // so the detail panes move *under* the table inside Main instead. Read
  // straight from matchMedia on the first render (rather than Mantine's
  // default of settling it in an effect) so a narrow load doesn't briefly
  // mount AsideSplit in the aside -- that flash would fire the selected
  // record's whole detail fetch just to unmount it a tick later.
  const stacked = useMediaQuery(STACKED_QUERY, false, { getInitialValueInEffect: false });

  // Drag-to-resize for the Main/Aside divider, one width per view.key (see
  // ASIDE_WIDTHS_KEY's doc comment). A view missing from the map means
  // "nobody's dragged it here" -- AppShell's own `width: "50%"` below keeps
  // doing the job it always did for that view. Only a completed drag ever
  // calls writeStoredAsideWidths; live px values while dragging stay in
  // state only. asideRef reads the aside's own current rendered width at
  // drag-start instead of trusting the stored value is exactly what's on
  // screen, so the very first drag on a view (still on "50%") starts from
  // the truth rather than needing a separate px fallback.
  const [asideWidths, setAsideWidths] = useState<Record<string, number>>(readStoredAsideWidths);
  const [asideResizing, setAsideResizing] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const asideDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const asideWidth = view ? asideWidths[view.key] ?? null : null;

  const handleAsideResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    const asideEl = asideRef.current;
    if (!asideEl || !view) return;
    e.preventDefault();
    asideDragRef.current = { startX: e.clientX, startWidth: asideEl.getBoundingClientRect().width };
    setAsideResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleAsideResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = asideDragRef.current;
    if (!drag || !view) return;
    // The handle sits on the aside's left edge, so dragging it right (a
    // positive delta) shrinks the aside and grows Main, not the other way
    // round.
    const next = drag.startWidth - (e.clientX - drag.startX);
    const clamped = Math.min(Math.max(next, MIN_ASIDE_WIDTH), maxAsideWidth());
    setAsideWidths((widths) => ({ ...widths, [view.key]: clamped }));
  };
  const handleAsideResizeEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!asideDragRef.current) return;
    asideDragRef.current = null;
    setAsideResizing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    setAsideWidths((widths) => {
      writeStoredAsideWidths(widths);
      return widths;
    });
  };

  // A dragged-wide aside can end up wider than the window allows after a
  // later resize (or a reload into a narrower one) -- reclamp every stored
  // view's width against the same floor the drag itself respects, rather
  // than letting Main get squeezed under MIN_MAIN_WIDTH. No-ops for widths
  // already under the limit, and does nothing at all for views nobody's
  // dragged (they were never in the map to begin with).
  useEffect(() => {
    const clampToWindow = () => {
      setAsideWidths((widths) => {
        const max = maxAsideWidth();
        const next: Record<string, number> = {};
        let changed = false;
        for (const [key, width] of Object.entries(widths)) {
          next[key] = Math.min(width, max);
          if (next[key] !== width) changed = true;
        }
        return changed ? next : widths;
      });
    };
    window.addEventListener("resize", clampToWindow);
    return () => window.removeEventListener("resize", clampToWindow);
  }, []);

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
      <Title order={4} fw={600}>{t("Gramps Connect")}</Title>
    </Group>
  );

  // Lazy per-view load, same as the original spike's ensureViewLoaded()
  // call in selectView() -- a no-op if this view was already loaded
  // earlier this session.
  // A visual page has no store to load here -- it reads the Places and
  // Events caches, which useVisualData loads for itself. Home has no store
  // at all -- see homeStats.ts.
  useEffect(() => {
    if (isStorelessKey(activeKey)) return;
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

  // Background username -> full_name resolution for the message chat view
  // (MessageComposer.tsx) -- fire-and-forget so it's already warm by the
  // time a user opens a message thread, same lifetime as useLiveSync()
  // above. See userDirectory.ts for why this can't always resolve everyone.
  useEffect(() => {
    loadUserDirectory();
  }, []);

  return (
    <>
      <AppShell
        header={{ height: stacked ? HEADER_HEIGHT_STACKED : HEADER_HEIGHT }}
        // breakpoint 0 on both = never let AppShell switch them into its own
        // "mobile" mode, where a navbar/aside becomes 100% wide, drops its
        // Main offset, and so covers the content outright (position: fixed).
        // That's exactly what used to hide the table on a narrow window: the
        // aside painted over the whole of Main. Narrow is handled by
        // `stacked` below instead -- the icon rail just stays a rail, and
        // the aside is dropped rather than overlaid.
        navbar={{ width: NAVBAR_WIDTH, breakpoint: 0 }}
        // No aside on a visual page either: a map of every place at once
        // isn't another way of looking at one selected record, so there's
        // nothing for the detail panes to show beside it, and the plot wants
        // the width. Clicking a marker or a dot navigates to that record in
        // Places or Events, where they take over again. Same for Home: no
        // selected record, nothing for a detail pane to show.
        aside={stacked || visualKey || isHome ? undefined : { width: asideWidth ?? "50%", breakpoint: 0 }}
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
                <MenuBar draftStack={draftStack} />
              </Box>
            </Stack>
          ) : (
            <Group h="100%" px="md" justify="space-between" wrap="nowrap">
              <Group gap="lg" wrap="nowrap">
                {wordmark}
                <MenuBar draftStack={draftStack} />
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
          {visualKey === "tree" && (
            <Box style={{ height: visualHeight }}><TreeView subject={visualSubject} /></Box>
          )}
          {visualKey === "search" && (
            <Box style={{ height: visualHeight }}><SearchView /></Box>
          )}
          {/* Unlike the two above, not height-bounded to visualHeight: a
              dashboard's content isn't a canvas that measures itself against
              its frame, it's ordinary flowing text and lists, so it's sized
              to its content and Main scrolls past it like it already does
              for the stacked detail panes below. */}
          {isHome && <HomeView />}
          {/* Keyed by view.key so switching views remounts fresh local state
              (filter input/error, scroll position) rather than carrying it
              over from the previous view. Prefixed distinctly per element --
              React requires keys to be unique only among *siblings*, and
              these two are both direct children of the same fragment; reusing
              the bare view.key for both produced a real bug (a "duplicate
              key" warning, and FilterBar instances piling up instead of
              unmounting) caught by an end-to-end smoke test. */}
          {/* Bounded to visualHeight (same formula the map/timeline Box above
              uses) and laid out as a flex column so DataTable's own wrapper
              (flex: 1; min-height: 0 -- see DataTable.module.css) fills
              whatever's left under ListHeader/FilterBar, instead of the
              table guessing its own height via a magic-number vh calc. Only
              done when !stacked: stacked lets the whole page scroll instead
              (panes flow below the table, footer inline at the end), so the
              table there keeps CSS's own 45dvh media override rather than
              being bounded to the pane. */}
          {view && (
            <Box style={stacked ? undefined : { height: visualHeight, display: "flex", flexDirection: "column" }}>
              <ListHeader key={`header-${view.key}`} view={view} draftStack={draftStack} />
              <FilterBar key={`filter-${view.key}`} view={view} />
              <DataTable key={`table-${view.key}`} view={view} />
              {/* Pyodide add-on PoC, see pyodidePoc/ -- every real Gramps
                  object-type list (not the synthetic generated/messages/
                  story views layered on Media/Note), since a Gramplet
                  itself is tree-wide, not scoped to whichever table
                  happens to be open. OBJECT_QUERY_ENDPOINTS is the same
                  10-type map pyodideWorker.ts's filter()/get_object()
                  bridge already keys off of -- reused here rather than a
                  second, separately-maintained list of the same 10 keys. */}
              {view.key in OBJECT_QUERY_ENDPOINTS && <PyodidePocPanel viewKey={view.key} />}
            </Box>
          )}
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
              <AsideSplit key={`detail-${view.key}`} view={view} draftStack={draftStack} flow />
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
          // ref (not a style override) is how this reads the aside's own
          // rendered width at drag-start -- AppShellAside's default `mode`
          // sets `position: fixed` from an un-!important-ed CSS class, so a
          // `position: relative` *inline* here would win the cascade and
          // knock the aside loose from the viewport. The inner Box below is
          // the positioning context for the handle instead, leaving Aside's
          // own positioning untouched.
          <AppShell.Aside ref={asideRef}>
            <Box style={{ position: "relative", height: "100%" }}>
              {/* Straddles the aside's own left border (Mantine's default
                  withBorder line) rather than sitting flush against it, so
                  the grab target is wider than the 1px line a mouse would
                  otherwise have to land on exactly. Pointer capture (not a
                  window-level mousemove listener) keeps the drag tracking
                  even once the cursor leaves this 8px strip -- normal for a
                  fast horizontal drag. */}
              <Box
                onPointerDown={handleAsideResizeStart}
                onPointerMove={handleAsideResizeMove}
                onPointerUp={handleAsideResizeEnd}
                onDoubleClick={() => {
                  // Only this view's own entry -- other views' remembered
                  // widths are untouched.
                  setAsideWidths((widths) => {
                    if (!(view.key in widths)) return widths;
                    const next = { ...widths };
                    delete next[view.key];
                    writeStoredAsideWidths(next);
                    return next;
                  });
                }}
                style={{
                  position: "absolute",
                  insetBlock: 0,
                  left: -4,
                  width: 8,
                  cursor: "col-resize",
                  zIndex: 1,
                  touchAction: "none",
                  background: asideResizing ? "var(--mantine-color-blue-4)" : "transparent",
                }}
              />
              <AsideSplit key={`detail-${view.key}`} view={view} draftStack={draftStack} />
            </Box>
          </AppShell.Aside>
        )}

        {!stacked && (
          <AppShell.Footer>
            <StatusBar view={statusView} liveSyncStatus={liveSyncStatus} />
          </AppShell.Footer>
        )}
      </AppShell>
      {/* Lives outside AppShell, not inside either MenuBar instance --
          see draftStack's doc comment above for why. */}
      <EditDialogs draftStack={draftStack} />
      <MediaDropOverlay {...mediaDrop} />
    </>
  );
}
