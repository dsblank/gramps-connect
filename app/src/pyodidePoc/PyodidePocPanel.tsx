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
import { ActionIcon, Alert, Box, Group, Loader, Menu, ScrollArea, Tabs, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { getToken } from "../auth/auth";
import { CircleGlyphButton } from "../components/CircleGlyphButton";
import { getHomePersonHandle } from "../store/homePersonPreference";
import { getViewStore } from "../store/registry";
import { subscribeTreeChange } from "../store/treeChangeBus";
import { canAuthorGramplets, effectiveAddedViews, fetchGramplets, writeLocalAddedViews } from "./grampletMedia";
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
  // Gates "Create new Gramplet" and each tab's own edit-pencil below --
  // see grampletMedia.ts's GRAMPLET_AUTHOR_PERMISSION doc comment for why
  // this is a higher bar than plain Media edit rights. Read once per
  // render, same as every other hasPermissions() call site in this app
  // (the JWT it reads doesn't change mid-render).
  const canAuthor = canAuthorGramplets();
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
  // Bumped by the selection-subscription effect below, but only while the
  // active tab's Gramplet has listensToSelection set -- a second, separate
  // nonce from runNonce above (a different trigger: "the row selected on
  // this view changed" vs. "some tree data changed"), even though both
  // just force the run-effect to reconsider the same way.
  const [selectionNonce, setSelectionNonce] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  // One cached result per Gramplet id, so switching back to an
  // already-run tab reuses it instead of re-executing -- see the
  // run-effect below for how `code`/`runNonce` decide a cache hit vs. miss.
  // Only ever holds *finished* runs (status "done"/"error") -- a run still
  // queued or executing lives in runningRef below instead, until it ends.
  const resultCacheRef = useRef<
    Map<
      string,
      {
        code: string;
        runNonce: number;
        selectedHandle: string | null;
        whereExpr: string | null;
        status: RunStatus;
        response: PyodideWorkerResponse | null;
      }
    >
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
  const runningRef = useRef<
    Map<
      string,
      {
        code: string;
        runNonce: number;
        selectedHandle: string | null;
        whereExpr: string | null;
        runId: string;
        status: RunStatus;
        response: PyodideWorkerResponse | null;
      }
    >
  >(new Map());
  // runId -> Gramplet id, so the one shared worker.onmessage handler below
  // (set up once, not per-run) knows which runningRef entry a given
  // PyodideWorkerResponse belongs to -- the message itself only carries
  // the runId (see PyodideWorkerResponse in types.ts), not the Gramplet id.
  const runIdToGrampletRef = useRef<Map<string, string>>(new Map());
  // Which Gramplet id `response` currently belongs to, so the run-effect
  // below can tell "same Gramplet, rerunning because selection/filter/tree
  // data changed" (keep showing it -- see runWidgetEvent's identical
  // reasoning) apart from "just switched tabs to a different Gramplet"
  // (the old response is for the wrong Gramplet now, so it must be
  // cleared rather than briefly shown under the new tab).
  const shownGrampletRef = useRef<string | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  // Kept in sync every render (same pattern as collapsedRef above) so
  // getWorker()'s own onmessage handler -- set up once, long-lived -- can
  // read the *current* activeId without closing over a stale one.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rerunTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last selectedHandle the selection-subscription effect below has
  // seen, so it can tell a real change apart from ViewStore's subscribe()
  // firing for some *other* snapshot field (loadedCount, revision, ...) --
  // subscribe() itself carries no payload, just "something changed",
  // see viewStore.ts.
  const lastSelectedHandleRef = useRef<string | null>(null);
  // Same idea as lastSelectedHandleRef above, but for the filter-reactivity
  // half of the effect below (Gramplet.listensToFilter, ViewStore's
  // whereExpr).
  const lastWhereExprRef = useRef<string | null>(null);

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
          resultCacheRef.current.set(gid, {
            code: entry.code,
            runNonce: entry.runNonce,
            selectedHandle: entry.selectedHandle,
            whereExpr: entry.whereExpr,
            status: entry.status,
            response: entry.response,
          });
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

  // Selection/filter reactivity, opt-in per Gramplet (Gramplet.
  // listensToSelection / Gramplet.listensToFilter) -- unlike the
  // tree-change effect above (deliberately broad: any change, any
  // Gramplet), this only subscribes at all when the *active* tab's own
  // Gramplet asked for at least one of the two, so a plain tree-wide
  // summary Gramplet (most of them) pays nothing extra just because some
  // other row got clicked or the filter box was edited. Both live on the
  // same ViewStore snapshot, so one subscription covers both -- carries no
  // payload (just "something in this view's snapshot changed" --
  // loadedCount, revision, ... as well as selectedHandle/whereExpr), so
  // lastSelectedHandleRef/lastWhereExprRef are what tell a real change in
  // the field this Gramplet actually asked about apart from one of those
  // unrelated snapshot updates (or a change in the *other* field, when
  // only one of the two flags is set). Only the active tab reacts, same as
  // the tree-change effect -- a backgrounded listening Gramplet just picks
  // up the latest selection/filter next time it's reactivated (its own
  // activeId-driven run, below).
  useEffect(() => {
    const gramplet = gramplets.find((g) => g.id === activeId);
    const listensToSelection = gramplet?.listensToSelection ?? false;
    const listensToFilter = gramplet?.listensToFilter ?? false;
    if (!listensToSelection && !listensToFilter) return;
    const store = getViewStore(viewKey);
    const snapshot = store.getSnapshot();
    lastSelectedHandleRef.current = snapshot.selectedHandle;
    lastWhereExprRef.current = snapshot.whereExpr;
    return store.subscribe(() => {
      const snap = store.getSnapshot();
      const selectionChanged = listensToSelection && snap.selectedHandle !== lastSelectedHandleRef.current;
      const filterChanged = listensToFilter && snap.whereExpr !== lastWhereExprRef.current;
      lastSelectedHandleRef.current = snap.selectedHandle;
      lastWhereExprRef.current = snap.whereExpr;
      if (selectionChanged || filterChanged) setSelectionNonce((n) => n + 1);
    });
  }, [viewKey, activeId, gramplets]);

  // Which of the fetched Gramplets show as a tab on *this* view in *this
  // browser* (effectiveAddedViews() -- this viewer's own localStorage
  // choice, see grampletMedia.ts) vs. which are eligible but not added yet
  // (`views` says this type is allowed, but it's not in the effective
  // addedViews) -- the "+ Add Gramplet" menu's own options. `views` falls
  // back to OBJECT_TYPES only for TS's sake -- fetchGramplets() already
  // normalizes every real Gramplet to have it set, see grampletMedia.ts.
  const tabGramplets = gramplets.filter((g) => effectiveAddedViews(g).includes(viewKey));
  const availableGramplets = gramplets.filter(
    (g) => (g.views ?? OBJECT_TYPES).includes(viewKey) && !effectiveAddedViews(g).includes(viewKey)
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

  // Local-only now (F9) -- no permission needed, no tree write, and no
  // `gramplet.handle` guard either (this browser's own tab layout isn't
  // tied to the Media object's existence the way saving its manifest was).
  // setGramplets() with a new array (same contents) is just to force a
  // re-render -- tabGramplets/availableGramplets above read
  // effectiveAddedViews() fresh on every render, they just have no other
  // way to know a plain localStorage write happened.
  function removeFromView(gramplet: Gramplet) {
    writeLocalAddedViews(gramplet.id, effectiveAddedViews(gramplet).filter((v) => v !== viewKey));
    setGramplets((prev) => [...prev]);
  }

  function addToView(gramplet: Gramplet) {
    writeLocalAddedViews(gramplet.id, [...effectiveAddedViews(gramplet), viewKey]);
    setGramplets((prev) => [...prev]);
    setActiveId(gramplet.id);
  }

  // Shared by "Create new Gramplet" (in the same menu as "+ Add
  // Gramplet") and each tab's own edit-pencil: either way, a refetch picks
  // up the save, and selecting it as the active tab makes the result
  // immediately visible. Doesn't touch this view's own tab layout --
  // handleNewGrampletSaved below does that for the "new" case, and editing
  // an existing tab shouldn't move it in or out of anyone's view at all.
  async function handleGrampletDialogSaved(gramplet: Gramplet) {
    await loadGramplets();
    setActiveId(gramplet.id);
  }

  // "Create new Gramplet"'s own onSaved -- unlike an edit, a brand new
  // Gramplet should show up as a tab right back where it was created
  // (matching what `newGramplet(defaultViewKey)`'s in-memory addedViews
  // used to do server-side, before F9 made addedViews local-only and
  // stopped writing it to the tree at all -- see grampletMedia.ts's
  // uploadGramplet()). `gramplet.addedViews` here is that same in-memory
  // value GrampletEditDialog's handleSave() computed and handed back, just
  // never persisted -- seeding *this browser's* localStorage with it is
  // this view's replacement for what used to be a shared tree write.
  async function handleNewGrampletSaved(gramplet: Gramplet) {
    if (gramplet.addedViews?.length) writeLocalAddedViews(gramplet.id, gramplet.addedViews);
    await handleGrampletDialogSaved(gramplet);
  }

  // Runs the selected tab's gramplet -- on mount (the initially-active
  // tab), again whenever `gramplets` itself changes (e.g. a live-sync
  // reload picked up an edited Gramplet), again whenever `runNonce` is
  // bumped (the live-sync subscription above, for a tree change to
  // something other than a Gramplet itself), again whenever `viewKey`
  // changes (the same Gramplet id can be a tab on more than one view --
  // its selectedType/selectedHandle below differ per view even when
  // nothing else does), and again whenever `selectionNonce` is bumped
  // (the selection/filter-subscription effect above, only for a Gramplet
  // with listensToSelection and/or listensToFilter set). Three cases,
  // checked in order:
  //  1. resultCacheRef already has a *finished* result for this exact
  //     code/runNonce (and, only for whichever of selectedHandle/whereExpr
  //     this Gramplet actually listens to) -- reuse it, no re-run. A
  //     Gramplet's code is typically a one-shot query, not something that
  //     needs re-executing just because the user looked away and back --
  //     and a non-listening Gramplet's cache stays valid across a
  //     selection/filter change it never asked to know about, same as it
  //     always has.
  //  2. runningRef already has this exact code/runNonce/selectedHandle/
  //     whereExpr *in flight* (queued or actively running, from an earlier
  //     selection of this same tab that hasn't finished yet) -- reattach
  //     to it (show whatever it's at right now) rather than posting a
  //     second, redundant RunGrampletRequest that would restart it from
  //     scratch.
  //  3. Neither -- genuinely new, so post a RunGrampletRequest (carrying
  //     the view's *current* selectedType/selectedHandle, read fresh here
  //     regardless of whether this particular run was triggered BY a
  //     selection change) and record it in runningRef. getWorker()'s own
  //     onmessage handler (set up once, not here) tracks it from here on,
  //     whether or not this tab stays selected until it finishes.
  // `cancelled` guards only the getToken() gap in case 3: a real async
  // call (may silently refresh), so a fast tab switch away before it
  // resolves shouldn't register/post a run for a tab already abandoned.
  useEffect(() => {
    const gramplet = gramplets.find((g) => g.id === activeId);
    if (!gramplet) return;
    const cacheKey = gramplet.id;
    const listensToSelection = gramplet.listensToSelection ?? false;
    const listensToFilter = gramplet.listensToFilter ?? false;
    const viewSnapshot = getViewStore(viewKey).getSnapshot();
    const selectedHandle = viewSnapshot.selectedHandle;
    const selectedType = selectedHandle !== null ? viewKey : null;
    const whereExpr = viewSnapshot.whereExpr;

    const cached = resultCacheRef.current.get(cacheKey);
    if (
      cached &&
      cached.code === gramplet.code &&
      cached.runNonce === runNonce &&
      (!listensToSelection || cached.selectedHandle === selectedHandle) &&
      (!listensToFilter || cached.whereExpr === whereExpr)
    ) {
      setRunStatus(cached.status);
      setResponse(cached.response);
      shownGrampletRef.current = cacheKey;
      return;
    }

    const inFlight = runningRef.current.get(cacheKey);
    if (
      inFlight &&
      inFlight.code === gramplet.code &&
      inFlight.runNonce === runNonce &&
      (!listensToSelection || inFlight.selectedHandle === selectedHandle) &&
      (!listensToFilter || inFlight.whereExpr === whereExpr)
    ) {
      setRunStatus(inFlight.status);
      setResponse(inFlight.response);
      shownGrampletRef.current = cacheKey;
      return;
    }

    // Same Gramplet as what's already on screen (a selection/filter change,
    // or a live tree-change bump via runNonce) -- don't null out `response`,
    // same reasoning as runWidgetEvent below: GrampletResultView keeps
    // rendering the *previous* blocks through "queued"/"loading" so the
    // panel updates in place instead of flickering out to placeholder text
    // and back. A genuine tab switch (cacheKey differs from what's shown)
    // still clears it -- the old response belongs to a different Gramplet.
    const rerunningSameGramplet = shownGrampletRef.current === cacheKey;
    shownGrampletRef.current = cacheKey;
    // Seeds the runningRef entry below with whatever's already on screen
    // (rather than always null) for the same reason `rerunningSameGramplet`
    // exists at all: the "started" ack that arrives once the worker
    // actually picks this run up only updates `entry.status` (to
    // "loading"), not `entry.response` (see onmessage below) -- so
    // whatever `entry.response` was seeded with here is exactly what
    // setResponse(entry.response) pushes out at that point. Registering it
    // as null (as this used to, unconditionally) meant that ack alone
    // wiped the previous blocks back to placeholder text a moment after
    // this effect had deliberately chosen not to -- the actual source of
    // the "Running…" flicker, not the setResponse(null) above.
    const priorResponse = rerunningSameGramplet ? response : null;

    let cancelled = false;
    const runId = crypto.randomUUID();
    (async () => {
      setRunStatus("queued");
      if (!rerunningSameGramplet) {
        setResponse(null);
      }
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
          resultCacheRef.current.set(cacheKey, {
            code: gramplet.code,
            runNonce,
            selectedHandle,
            whereExpr,
            status: "error",
            response: errorResponse,
          });
        }
        return;
      }
      if (cancelled) return;
      runIdToGrampletRef.current.set(runId, cacheKey);
      runningRef.current.set(cacheKey, {
        code: gramplet.code,
        runNonce,
        selectedHandle,
        whereExpr,
        runId,
        status: "queued",
        response: priorResponse,
      });
      getWorker().postMessage({
        type: "run-gramplet",
        code: gramplet.code,
        token,
        runId,
        grampletId: gramplet.id,
        selectedType,
        selectedHandle,
        whereExpr,
        homePersonHandle: getHomePersonHandle(),
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, gramplets, runNonce, selectionNonce, viewKey]);

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
    // Read fresh, same as the run-effect above -- a widget click always
    // carries whatever's currently selected/filtered, regardless of
    // listensToSelection/listensToFilter (those flags only govern whether
    // a selection/filter change *by itself* triggers a rerun, not what a
    // rerun for some other reason sees).
    const viewSnapshot = getViewStore(viewKey).getSnapshot();
    const selectedHandle = viewSnapshot.selectedHandle;
    const selectedType = selectedHandle !== null ? viewKey : null;
    const whereExpr = viewSnapshot.whereExpr;
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
    runningRef.current.set(cacheKey, {
      code: gramplet.code,
      runNonce,
      selectedHandle,
      whereExpr,
      runId,
      status: "queued",
      // Same reasoning as the run-effect's own priorResponse above: seeded
      // with what's already on screen (never null here -- a widget rerun
      // always wants to keep it), so the "started" ack's own
      // setResponse(entry.response) doesn't wipe it back to null in
      // between this call's own (deliberately skipped) clear and the
      // eventual terminal response.
      response,
    });
    getWorker().postMessage({
      type: "run-gramplet",
      code: gramplet.code,
      token,
      runId,
      grampletId: gramplet.id,
      selectedType,
      selectedHandle,
      whereExpr,
      homePersonHandle: getHomePersonHandle(),
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
                            {canAuthor && (
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
                            )}
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
                      {canAuthor && (
                        <Menu.Item onClick={() => setCreatingNew(true)}>Create new Gramplet</Menu.Item>
                      )}
                      {availableGramplets.length > 0 && (
                        <>
                          <Menu.Divider />
                          <ScrollArea.Autosize mah={300} type="auto">
                            {availableGramplets.map((gramplet) => (
                              <Tooltip
                                key={gramplet.id}
                                label={gramplet.description}
                                disabled={!gramplet.description}
                                position="right"
                                openDelay={300}
                                multiline
                                w={260}
                                withArrow
                              >
                                <Menu.Item onClick={() => addToView(gramplet)} style={{ maxWidth: 320 }}>
                                  <Text size="sm">{gramplet.label}</Text>
                                </Menu.Item>
                              </Tooltip>
                            ))}
                          </ScrollArea.Autosize>
                        </>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Tabs>
              <Box
                p="sm"
                pos="relative"
                className={classes.resultArea}
                style={{ flex: 1, minHeight: 0, overflow: "auto" }}
              >
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
                      color="gray.6"
                      size={32}
                      radius="xl"
                      aria-label="Expand"
                      title="Expand"
                      onClick={() => setResultExpanded(true)}
                      className={classes.expandButton}
                      // Solid + round, not the subtle default -- this
                      // sits directly over whatever the Gramplet rendered
                      // (a white chart, say), where a low-contrast subtle
                      // button disappears. Hidden until resultArea is
                      // hovered/focused (see .expandButton in the CSS
                      // module) so it doesn't permanently cover content.
                      style={{ position: "absolute", top: 14, right: 14, zIndex: 1 }}
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
            onSaved={handleNewGrampletSaved}
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
