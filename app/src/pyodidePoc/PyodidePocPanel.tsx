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
import { Alert, Box, Group, Loader, Menu, Tabs, Text, UnstyledButton } from "@mantine/core";
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
  const [height, setHeight] = useState<number>(readStoredHeight);
  const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed(viewKey));
  const [creatingNew, setCreatingNew] = useState(false);
  const [editingHandle, setEditingHandle] = useState<string | null>(null);
  // Bumped by the live-sync subscription below to force the active tab's
  // Gramplet to re-run even when `gramplets` itself hasn't changed (e.g. a
  // Person was edited, not a Gramplet). Part of the run-effect's own deps.
  const [runNonce, setRunNonce] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rerunTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function getWorker(): Worker {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./pyodideWorker.ts", import.meta.url), {
        type: "module",
      });
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
  // tab), again every time the active tab changes (the "runs when that
  // tab is selected" behavior asked for), again whenever `gramplets`
  // itself changes (e.g. a live-sync reload picked up an edited Gramplet),
  // and again whenever `runNonce` is bumped (the live-sync subscription
  // above, for a tree change to something other than a Gramplet itself).
  // `cancelled` guards against a fast tab switch: getToken() is a real
  // async call (may silently refresh), so a stale response landing after
  // the user has already moved to another tab shouldn't overwrite that
  // tab's output.
  useEffect(() => {
    const gramplet = gramplets.find((g) => g.id === activeId);
    if (!gramplet) return;
    let cancelled = false;
    (async () => {
      setRunStatus("loading");
      setResponse(null);
      let token: string;
      try {
        token = await getToken();
      } catch (err) {
        if (!cancelled) {
          setRunStatus("error");
          setResponse({ type: "error", text: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      if (cancelled) return;
      const worker = getWorker();
      worker.onmessage = (event: MessageEvent<PyodideWorkerResponse>) => {
        if (cancelled) return;
        setRunStatus(event.data.type === "error" ? "error" : "done");
        setResponse(event.data);
      };
      worker.postMessage({ type: "run-gramplet", code: gramplet.code, token });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, gramplets, runNonce]);

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
                            <CircleGlyphButton
                              glyph="✏️"
                              label={`Edit ${gramplet.label}`}
                              size={14}
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingHandle(gramplet.handle ?? null);
                              }}
                            />
                            <CircleGlyphButton
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
              <Box p="sm" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {tabGramplets.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    {gramplets.length === 0
                      ? "No Gramplets on this tree yet -- use + Add Gramplet above to create one."
                      : `No Gramplets added to ${typeLabel} yet -- use + Add Gramplet above.`}
                  </Text>
                ) : (
                  <GrampletResultView status={runStatus} response={response} />
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
    </Box>
  );
}
