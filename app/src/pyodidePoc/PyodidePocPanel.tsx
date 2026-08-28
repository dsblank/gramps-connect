// See types.ts for what this PoC is for. Rendered by App.tsx below every
// real Gramps object-type list (person/family/event/place/repository/
// source/citation/media/note/tag -- see App.tsx's OBJECT_QUERY_ENDPOINTS
// check), not just one: a Gramplet is tree-wide, not scoped to whichever
// table happens to be open, so this same panel (same tabs, same state)
// just keeps showing wherever the user is -- only *which* of the fetched
// Gramplets show as tabs here changes, per `viewKey` (see the
// tabGramplets/availableGramplets split below). One Gramplet (named after
// Gramps desktop's own sidebar-widget addons) per tab. Gramplets
// themselves are real tree data -- "Gramplet"-tagged Media objects,
// fetched fresh on mount (see grampletMedia.ts) -- not a hardcoded list,
// so this panel looks the same to every client/session on the same tree.
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ActionIcon, Alert, Box, Group, Loader, Menu, Tabs, Text, UnstyledButton } from "@mantine/core";
import { getToken } from "../auth/auth";
import { CircleGlyphButton } from "../components/CircleGlyphButton";
import { subscribeTreeChange } from "../store/treeChangeBus";
import { fetchGramplets, saveGrampletManifest } from "./grampletMedia";
import { GrampletResultView, type RunStatus } from "./GrampletResultView";
import { OBJECT_TYPES, OBJECT_TYPE_LABELS } from "./objectEndpoints";
import type { Gramplet, PyodideWorkerResponse } from "./types";
import classes from "./PyodidePocPanel.module.css";

// Pulls in prismjs/react-simple-code-editor -- lazy for the same reason
// MenuBar.tsx's own "Add Gramplet…" import is, so a session that never
// opens this never fetches either.
const GrampletEditDialog = lazy(() =>
  import("./GrampletEditDialog").then((m) => ({ default: m.GrampletEditDialog }))
);

type ListStatus = "loading" | "ready" | "error";

// Persisted the same way DataTable's own column widths are (see
// store/columnWidths.ts) -- one localStorage number, written on drag end
// rather than per pointermove frame.
const HEIGHT_STORAGE_KEY = "gramps-connect:pyodidePocPanelHeight";
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

function clampHeight(height: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height));
}

function readStoredHeight(): number {
  const raw = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampHeight(raw) : DEFAULT_HEIGHT;
}

// Per-view (one key per object-type list, e.g. Person vs. Family each
// remember their own), unlike `height` above which is one shared value --
// a Gramplet author working in Family doesn't want Person's "I left this
// expanded" choice to leak over. Collapsed is the default (no stored key
// yet) rather than expanded: most lists most of the time have no reason
// to show this at all, it's an opt-in tool, not a permanent fixture.
function collapsedStorageKey(viewKey: string): string {
  return `gramps-connect:pyodidePocPanelCollapsed:${viewKey}`;
}

function readStoredCollapsed(viewKey: string): boolean {
  const raw = localStorage.getItem(collapsedStorageKey(viewKey));
  return raw === null ? true : raw === "1";
}

export function PyodidePocPanel({ viewKey }: { viewKey: string }) {
  const [gramplets, setGramplets] = useState<Gramplet[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>("loading");
  const [response, setResponse] = useState<PyodideWorkerResponse | null>(null);
  // "Expand" overlay -- state, not props, so the single <GrampletResultView>
  // element further down stays at the exact same position in the JSX tree
  // whether expanded or not (only which container its createPortal() call
  // targets changes); that's what lets React move its already-rendered DOM
  // into the overlay and back without unmounting it -- no rerun, no lost
  // widget state (a not-yet-blurred text input, scroll position, ...), only
  // a DOM reparent. Callback-ref state (not useRef) for both containers,
  // since a plain ref wouldn't be readable during render before its first
  // paint, and resultExpandedHost in particular doesn't exist at all until
  // the overlay below actually mounts.
  const [resultExpanded, setResultExpanded] = useState(false);
  const [resultInlineHost, setResultInlineHost] = useState<HTMLDivElement | null>(null);
  const [resultExpandedHost, setResultExpandedHost] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>(readStoredHeight);
  const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed(viewKey));
  const [creatingNew, setCreatingNew] = useState(false);
  const [editingHandle, setEditingHandle] = useState<string | null>(null);
  // Bumped by the live-sync subscription below to force the active tab's
  // Gramplet to re-run even when `gramplets` itself hasn't changed (e.g. a
  // Person was edited, not a Gramplet). Part of the run-effect's own deps.
  const [runNonce, setRunNonce] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  // One cached result per Gramplet id, so switching back to an
  // already-run tab reuses it instead of re-executing -- see the
  // run-effect below for how `code`/`runNonce` decide a cache hit vs. miss.
  // Only ever holds *finished* runs (status "done"/"error") -- a run still
  // queued or executing lives in runningRef below instead, until it ends.
  const resultCacheRef = useRef<
    Map<string, { code: string; runNonce: number; status: RunStatus; response: PyodideWorkerResponse | null }>
  >(new Map());
  // One in-flight run per Gramplet id, queued or actively running (see
  // RunStatus) -- separate from resultCacheRef so re-selecting a tab whose
  // run hasn't finished yet (switch away, switch back before it's done)
  // reattaches to what's already running instead of the run-effect below
  // mistaking "not in resultCacheRef yet" for "never started" and posting
  // a duplicate RunGrampletRequest, restarting it from scratch. Entries
  // move to resultCacheRef and are deleted from here once their run ends
  // (see getWorker()'s own onmessage handler below) -- kept updated for
  // *every* in-flight Gramplet, active tab or not, so switching back to a
  // backgrounded one shows its latest progress rather than nothing.
  const runningRef = useRef<Map<string, { code: string; runNonce: number; runId: string; status: RunStatus; response: PyodideWorkerResponse | null }>>(
    new Map()
  );
  // runId -> Gramplet id, so the one shared worker.onmessage handler below
  // (set up once, not per-run) knows which runningRef entry a given
  // PyodideWorkerResponse belongs to -- the message itself only carries
  // the runId (see PyodideWorkerResponse in types.ts), not the Gramplet id.
  const runIdToGrampletRef = useRef<Map<string, string>>(new Map());
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  // Kept in sync every render (same pattern as collapsedRef above) so
  // getWorker()'s own onmessage handler -- set up once, long-lived -- can
  // read the *current* activeId without closing over a stale one.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rerunTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function getWorker(): Worker {
    if (!workerRef.current) {
      const worker = new Worker(new URL("./pyodideWorker.ts", import.meta.url), { type: "module" });
      // Set up once for the worker's whole lifetime (not reassigned per
      // run, the way it used to be) -- pyodideWorker.ts serializes
      // execution but keeps running a backgrounded tab's Gramplet to
      // completion, so messages for *any* in-flight run can arrive at any
      // time, not just the currently active tab's. Routes each one via
      // runIdToGrampletRef/runningRef instead of assuming the latest
      // message belongs to whichever run was posted most recently.
      worker.onmessage = (event: MessageEvent<PyodideWorkerResponse>) => {
        const data = event.data;
        const gid = runIdToGrampletRef.current.get(data.runId);
        if (!gid) return; // Unknown/already-cleaned-up runId -- nothing to do.
        const entry = runningRef.current.get(gid);
        if (!entry || entry.runId !== data.runId) return; // Superseded by a newer run for this same tab.

        if (data.type === "started") {
          entry.status = "loading";
        } else if (data.type === "progress") {
          entry.status = "loading";
          entry.response = data;
        } else {
          // Terminal ("blocks" or "error") -- this run is over. Move it
          // from runningRef into the finished-results cache and stop
          // routing further messages for this runId (there shouldn't be
          // any more, but belt-and-suspenders).
          entry.status = data.type === "error" ? "error" : "done";
          entry.response = data;
          runningRef.current.delete(gid);
          runIdToGrampletRef.current.delete(data.runId);
          resultCacheRef.current.set(gid, { code: entry.code, runNonce: entry.runNonce, status: entry.status, response: entry.response });
        }

        if (gid === activeIdRef.current) {
          setRunStatus(entry.status);
          setResponse(entry.response);
        }
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }

  async function loadGramplets() {
    setListStatus("loading");
    try {
      setGramplets(await fetchGramplets());
      setListStatus("ready");
    } catch (err) {
      console.error("[gramplets] failed to load", err);
      setListStatus("error");
    }
  }

  useEffect(() => {
    loadGramplets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-sync reactivity. A Gramplet is a tagged Media object, so deleting
  // or editing one anywhere -- the Media list's own delete button, another
  // tab's edit-pencil, another user entirely -- should be reflected here
  // without a manual reload: a "media" table notification refetches the
  // list (debounced 300ms, same window ViewStore.requeryDebounced uses,
  // so a burst of changes only refetches once), which is what actually
  // fixes "deleting a Gramplet doesn't drop its tab" -- tabGramplets/
  // availableGramplets above are derived straight from `gramplets`.
  //
  // Separately: which table should re-run the *active* tab's Gramplet?
  // Its Python code can read any object type, and there's no static way
  // to know which ones a given Gramplet actually touches -- so this is
  // deliberately broad rather than dependency-tracked: ANY tree change
  // re-runs it (bumping runNonce, in the run-effect's own deps below),
  // debounced longer (1s, a real Pyodide execution rather than a plain
  // refetch) and skipped while this panel is collapsed, since a rerun
  // nobody can see is wasted work. Only the one currently-visible tab
  // re-runs -- background tabs and other views' panels don't. A "media"
  // notification is handled by the reload above instead (which already
  // changes `gramplets`, itself in the run-effect's deps), not this path
  // too, so an edited Gramplet doesn't trigger two runs back to back.
  useEffect(() => {
    return subscribeTreeChange((notification) => {
      if (notification.table === "media") {
        if (reloadTimerRef.current) return;
        reloadTimerRef.current = setTimeout(() => {
          reloadTimerRef.current = null;
          loadGramplets();
        }, 300);
        return;
      }
      if (collapsedRef.current || rerunTimerRef.current) return;
      rerunTimerRef.current = setTimeout(() => {
        rerunTimerRef.current = null;
        setRunNonce((n) => n + 1);
      }, 1000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which of the fetched Gramplets show as a tab on *this* view
  // (`addedViews`, toggled via the (+)/(-) glyphs below) vs. which are
  // eligible but not added yet (`views` says this type is allowed, but
  // it's not in `addedViews`) -- the "+ Add Gramplet" menu's own options.
  // Both fall back to OBJECT_TYPES ("every type") only for TS's sake --
  // fetchGramplets() already normalizes every real Gramplet to have both
  // arrays set, see grampletMedia.ts.
  const tabGramplets = gramplets.filter((g) => (g.addedViews ?? OBJECT_TYPES).includes(viewKey));
  const availableGramplets = gramplets.filter(
    (g) => (g.views ?? OBJECT_TYPES).includes(viewKey) && !(g.addedViews ?? OBJECT_TYPES).includes(viewKey)
  );

  // Keeps the active tab valid across a view switch (Person -> Family
  // changes which Gramplets are tabs here at all) and after an add/remove
  // changes this view's own tab set.
  useEffect(() => {
    setActiveId((current) => (current && tabGramplets.some((g) => g.id === current) ? current : tabGramplets[0]?.id ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, gramplets]);

  // Re-reads this view's own stored collapsed state on a view switch --
  // App.tsx doesn't remount this component per view (a Gramplet is
  // tree-wide, see this file's own top comment), so the `collapsed`
  // state's initial useState() lazy-init only ever runs once, for
  // whichever view was active on mount.
  useEffect(() => {
    setCollapsed(readStoredCollapsed(viewKey));
  }, [viewKey]);

  // Escape closes the "expand" overlay, same as clicking its backdrop/close
  // button below -- only listens while it's actually open.
  useEffect(() => {
    if (!resultExpanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setResultExpanded(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resultExpanded]);

  async function removeFromView(gramplet: Gramplet) {
    if (!gramplet.handle) return;
    const updated = { ...gramplet, addedViews: (gramplet.addedViews ?? OBJECT_TYPES).filter((v) => v !== viewKey) };
    try {
      await saveGrampletManifest(gramplet.handle, updated);
      setGramplets((prev) => prev.map((g) => (g.id === gramplet.id ? updated : g)));
    } catch (err) {
      console.error("[gramplets] failed to remove from view", err);
    }
  }

  async function addToView(gramplet: Gramplet) {
    if (!gramplet.handle) return;
    const updated = { ...gramplet, addedViews: [...(gramplet.addedViews ?? OBJECT_TYPES), viewKey] };
    try {
      await saveGrampletManifest(gramplet.handle, updated);
      setGramplets((prev) => prev.map((g) => (g.id === gramplet.id ? updated : g)));
      setActiveId(gramplet.id);
    } catch (err) {
      console.error("[gramplets] failed to add to view", err);
    }
  }

  // Shared by "Create new Gramplet" (in the same menu as "+ Add
  // Gramplet") and each tab's own edit-pencil: either way, a refetch
  // picks up the save, and selecting it as the active tab makes the
  // result immediately visible -- "Create new Gramplet" already saved
  // with `views`/`addedViews` scoped to this view (see
  // GrampletEditDialog's own defaultViewKey handling), so it's already a
  // tab here by the time this runs; editing an existing tab just re-runs
  // whatever changed.
  async function handleGrampletDialogSaved(gramplet: Gramplet) {
    await loadGramplets();
    setActiveId(gramplet.id);
  }

  // Runs the selected tab's gramplet -- on mount (the initially-active
  // tab), again whenever `gramplets` itself changes (e.g. a live-sync
  // reload picked up an edited Gramplet), and again whenever `runNonce` is
  // bumped (the live-sync subscription above, for a tree change to
  // something other than a Gramplet itself). Three cases, checked in
  // order:
  //  1. resultCacheRef already has a *finished* result for this exact
  //     code/runNonce -- reuse it, no re-run. A Gramplet's code is
  //     typically a one-shot query, not something that needs re-executing
  //     just because the user looked away and back.
  //  2. runningRef already has this exact code/runNonce *in flight*
  //     (queued or actively running, from an earlier selection of this
  //     same tab that hasn't finished yet) -- reattach to it (show
  //     whatever it's at right now) rather than posting a second,
  //     redundant RunGrampletRequest that would restart it from scratch.
  //  3. Neither -- genuinely new, so post a RunGrampletRequest and record
  //     it in runningRef. getWorker()'s own onmessage handler (set up
  //     once, not here) tracks it from here on, whether or not this tab
  //     stays selected until it finishes.
  // `cancelled` guards only the getToken() gap in case 3: a real async
  // call (may silently refresh), so a fast tab switch away before it
  // resolves shouldn't register/post a run for a tab already abandoned.
  useEffect(() => {
    const gramplet = gramplets.find((g) => g.id === activeId);
    if (!gramplet) return;
    const cacheKey = gramplet.id;

    const cached = resultCacheRef.current.get(cacheKey);
    if (cached && cached.code === gramplet.code && cached.runNonce === runNonce) {
      setRunStatus(cached.status);
      setResponse(cached.response);
      return;
    }

    const inFlight = runningRef.current.get(cacheKey);
    if (inFlight && inFlight.code === gramplet.code && inFlight.runNonce === runNonce) {
      setRunStatus(inFlight.status);
      setResponse(inFlight.response);
      return;
    }

    let cancelled = false;
    const runId = crypto.randomUUID();
    (async () => {
      setRunStatus("queued");
      setResponse(null);
      let token: string;
      try {
        token = await getToken();
      } catch (err) {
        if (!cancelled) {
          const errorResponse: PyodideWorkerResponse = {
            type: "error",
            text: err instanceof Error ? err.message : String(err),
            blocks: [],
            runId,
          };
          setRunStatus("error");
          setResponse(errorResponse);
          resultCacheRef.current.set(cacheKey, { code: gramplet.code, runNonce, status: "error", response: errorResponse });
        }
        return;
      }
      if (cancelled) return;
      runIdToGrampletRef.current.set(runId, cacheKey);
      runningRef.current.set(cacheKey, { code: gramplet.code, runNonce, runId, status: "queued", response: null });
      getWorker().postMessage({ type: "run-gramplet", code: gramplet.code, token, runId, grampletId: gramplet.id });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, gramplets, runNonce]);

  // A click on an st.*-widget in the active tab's own rendered output (see
  // GrampletResultView's onWidgetEvent prop / stBootstrap.ts's st.button())
  // -- posts a fresh RunGrampletRequest the same way the effect above does,
  // registered into runningRef/runIdToGrampletRef so getWorker()'s one
  // shared onmessage handler (below) drives it through queued/loading/done
  // exactly like any other run, including caching the finished result into
  // resultCacheRef. Unlike the effect, this always posts a genuinely new
  // run -- a widget click is itself the reason to rerun, so there's no
  // cache lookup to short-circuit here.
  async function runWidgetEvent(key: string, value: unknown) {
    const gramplet = gramplets.find((g) => g.id === activeId);
    if (!gramplet) return;
    const cacheKey = gramplet.id;
    const runId = crypto.randomUUID();
    setRunStatus("queued");
    // Deliberately not setResponse(null) here, unlike the effect above --
    // GrampletResultView.tsx keeps rendering the *previous* response's
    // blocks through "queued"/"loading" now specifically so a widget
    // rerun updates in place (the clicked button/input stays on screen)
    // instead of flickering out to placeholder text and back.
    let token: string;
    try {
      token = await getToken();
    } catch (err) {
      const errorResponse: PyodideWorkerResponse = {
        type: "error",
        text: err instanceof Error ? err.message : String(err),
        blocks: [],
        runId,
      };
      setRunStatus("error");
      setResponse(errorResponse);
      return;
    }
    runIdToGrampletRef.current.set(runId, cacheKey);
    runningRef.current.set(cacheKey, { code: gramplet.code, runNonce, runId, status: "queued", response: null });
    getWorker().postMessage({
      type: "run-gramplet",
      code: gramplet.code,
      token,
      runId,
      grampletId: gramplet.id,
      widgetEvent: { key, value },
    });
  }

  // Divider sits above the panel and drags its height -- same pointer-
  // capture drag pattern as DataTable's column resizer (startResize
  // there), just along Y instead of X: dragging up (clientY decreasing)
  // grows the panel since it's anchored to the bottom of the flex column.
  function startResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    let finalHeight = startHeight;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      finalHeight = clampHeight(startHeight + (startY - ev.clientY));
      setHeight(finalHeight);
    }
    function onUp(ev: PointerEvent) {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(finalHeight));
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(collapsedStorageKey(viewKey), next ? "1" : "0");
      return next;
    });
  }

  const typeLabel = OBJECT_TYPE_LABELS[viewKey] ?? viewKey;

  return (
    <Box style={{ flex: "0 0 auto", display: "flex", flexDirection: "column" }}>
      {/* Drag handle, same pattern as DataTable's resizeHandle -- only
          meaningful (and only shown) while there's a panel below it to
          resize. */}
      {!collapsed && (
        <div
          onPointerDown={startResize}
          style={{
            height: 6,
            flexShrink: 0,
            cursor: "row-resize",
            borderTop: "1px solid var(--mantine-color-default-border)",
            background: "var(--mantine-color-body)",
          }}
        />
      )}
      {/* Collapsible header, same UnstyledButton + plain-text-triangle
          convention as AsideSplit.tsx's "Reference detail" strip. */}
      <UnstyledButton
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        style={{
          flexShrink: 0,
          textAlign: "left",
          padding: "6px var(--mantine-spacing-md)",
          borderTop: collapsed ? "1px solid var(--mantine-color-default-border)" : undefined,
          borderBottom: !collapsed ? "1px solid var(--mantine-color-default-border)" : undefined,
          background: "var(--mantine-color-default-hover)",
        }}
      >
        <Group gap={6} wrap="nowrap">
          <Text size="xs" c="dimmed">
            {collapsed ? "▴" : "▾"}
          </Text>
          <Text size="xs" c="dimmed" fw={600}>
            Gramplets
          </Text>
        </Group>
      </UnstyledButton>
      {!collapsed && (
        <Box
          style={{
            height,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {listStatus === "loading" && (
            <Group px="sm" pt="xs" gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                Loading Gramplets…
              </Text>
            </Group>
          )}
          {listStatus === "error" && (
            <Box px="sm" pt="xs">
              <Alert color="red" title="Couldn't load Gramplets">
                Check the console for details.
              </Alert>
            </Box>
          )}
          {listStatus === "ready" && (
            <>
              <Tabs value={activeId} onChange={setActiveId} style={{ flexShrink: 0 }}>
                <Group justify="space-between" wrap="nowrap" pr="sm" gap="xs">
                  <Tabs.List px="sm" style={{ flex: 1, minWidth: 0, overflowX: "auto", flexWrap: "nowrap" }}>
                    {tabGramplets.map((gramplet) => (
                      <Tabs.Tab
                        key={gramplet.id}
                        value={gramplet.id}
                        className={classes.tab}
                        style={{ paddingInlineStart: 0 }}
                        rightSection={
                          <Group gap={2} wrap="nowrap" className={classes.tabActions}>
                            {/* component="span" -- this Group sits inside
                                Tabs.Tab's own rightSection, and Tabs.Tab
                                itself renders as a real <button role="tab">;
                                CircleGlyphButton's default <button> would
                                otherwise nest inside it, invalid HTML (see
                                its own doc comment on this prop). */}
                            <CircleGlyphButton
                              component="span"
                              glyph="✏️"
                              label={`Edit ${gramplet.label}`}
                              size={14}
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingHandle(gramplet.handle ?? null);
                              }}
                            />
                            <CircleGlyphButton
                              component="span"
                              glyph="−"
                              label="Remove from view"
                              size={14}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromView(gramplet);
                              }}
                            />
                          </Group>
                        }
                      >
                        {gramplet.label}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <CircleGlyphButton glyph="+" label="Add a Gramplet" onClick={() => {}} />
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => setCreatingNew(true)}>Create new Gramplet</Menu.Item>
                      {availableGramplets.length > 0 && (
                        <>
                          <Menu.Divider />
                          {availableGramplets.map((gramplet) => (
                            <Menu.Item key={gramplet.id} onClick={() => addToView(gramplet)}>
                              {gramplet.label}
                            </Menu.Item>
                          ))}
                        </>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Tabs>
              <Box p="sm" pos="relative" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {tabGramplets.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    {gramplets.length === 0
                      ? "No Gramplets on this tree yet -- use + Add Gramplet above to create one."
                      : `No Gramplets added to ${typeLabel} yet -- use + Add Gramplet above.`}
                  </Text>
                ) : (
                  <>
                    <ActionIcon
                      variant="filled"
                      color="dark"
                      size={32}
                      radius="xl"
                      aria-label="Expand"
                      title="Expand"
                      onClick={() => setResultExpanded(true)}
                      // Solid dark + round, not the subtle default -- this
                      // sits directly over whatever the Gramplet rendered
                      // (a white chart, say), where a low-contrast subtle
                      // button disappears.
                      style={{ position: "absolute", top: 14, right: 14, zIndex: 1, opacity: 0.85 }}
                    >
                      <Text size="lg" c="white">
                        ⤢
                      </Text>
                    </ActionIcon>
                    {/* The actual result content mounts here (see the
                        createPortal() call below) -- kept as a plain empty
                        div rather than rendering <GrampletResultView>
                        directly so there's exactly one of it, portaled into
                        either this div or the overlay's div below. */}
                    <div ref={setResultInlineHost} />
                  </>
                )}
              </Box>
            </>
          )}
        </Box>
      )}
      {creatingNew && (
        <Suspense fallback={null}>
          <GrampletEditDialog
            target={{ kind: "new", defaultViewKey: viewKey }}
            onClose={() => setCreatingNew(false)}
            onSaved={handleGrampletDialogSaved}
          />
        </Suspense>
      )}
      {editingHandle && (
        <Suspense fallback={null}>
          <GrampletEditDialog
            target={{ kind: "edit", handle: editingHandle }}
            onClose={() => setEditingHandle(null)}
            onSaved={handleGrampletDialogSaved}
          />
        </Suspense>
      )}
      {/* Hand-rolled rather than Mantine's own <Modal> -- Modal unmounts its
          content whenever closed, so resultExpandedHost would never be
          ready in time for the very render that flips resultExpanded to
          true, and every close would throw away + recreate the dialog's own
          DOM instead of just detaching it (defeating the point below). */}
      {resultExpanded &&
        createPortal(
          <Box
            pos="fixed"
            style={{
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 300,
              background: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={() => setResultExpanded(false)}
          >
            <Box
              onClick={(e) => e.stopPropagation()}
              p="md"
              pos="relative"
              style={{
                background: "var(--mantine-color-body)",
                borderRadius: "var(--mantine-radius-md)",
                width: "90vw",
                height: "85vh",
                maxWidth: 1200,
                overflow: "auto",
              }}
            >
              <ActionIcon
                variant="filled"
                color="dark"
                size={32}
                radius="xl"
                aria-label="Close"
                title="Close"
                onClick={() => setResultExpanded(false)}
                style={{ position: "absolute", top: 18, right: 18, zIndex: 1, opacity: 0.85 }}
              >
                <Text size="lg" c="white">
                  ✕
                </Text>
              </ActionIcon>
              <div ref={setResultExpandedHost} />
            </Box>
          </Box>,
          // Not document.body -- React (since v17) scopes its synthetic
          // event delegation to the DOM node createRoot() was given
          // (main.tsx: document.getElementById("root")), not to `document`
          // globally. A portal mounted directly under document.body sits
          // outside that node's subtree, so React's own onClick/onChange
          // never fire for anything inside it -- found live: closing this
          // overlay via Escape (a plain window keydown listener) and the
          // st.*-widgets inside it (real addEventListener, see
          // GrampletResultView.tsx's HtmlOutput) both still worked, but
          // ObjectCellButton's table-row click (a normal React onClick)
          // silently didn't. document.getElementById("root") is that same
          // node main.tsx renders into, so portaling into it instead keeps
          // this overlay inside React's delegation scope while still
          // escaping the tab's own scrolling/clipped container for
          // position: fixed to cover the full viewport.
          document.getElementById("root") ?? document.body,
        )}
      {/* The one and only <GrampletResultView> -- always at this same
          position in the tree (see resultExpanded's own doc comment above),
          portaled into whichever of the two divs above is currently live.
          resultInlineHost stays mounted (just empty, once its content has
          moved) the whole time the overlay's open -- not just hidden behind
          it -- specifically so it's still there as a fallback target on the
          one render where resultExpanded has already flipped true but
          resultExpandedHost's own div hasn't committed/fired its ref
          callback yet: falling straight to resultExpandedHost there (null,
          on that one render) would make this whole expression falsy and
          unmount <GrampletResultView> for a frame, then remount it once the
          real target showed up -- found live as a visible flicker/flash of
          its "Running…" placeholder replacing whatever was actually
          showing. Falling back to resultInlineHost instead keeps it
          continuously mounted throughout, so it only ever *moves* (this
          same portal mechanic, just switching container a moment later),
          never unmounts. */}
      {(resultExpanded ? (resultExpandedHost ?? resultInlineHost) : resultInlineHost) &&
        createPortal(
          <GrampletResultView status={runStatus} response={response} onWidgetEvent={runWidgetEvent} />,
          (resultExpanded ? (resultExpandedHost ?? resultInlineHost) : resultInlineHost) as HTMLDivElement,
        )}
    </Box>
  );
}
