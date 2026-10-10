// One (window) Gramplet's floating window -- see GRAMPLETS_PLAN.md. Owns
// its own Pyodide worker (so several run truly in parallel, never queued
// behind each other or behind the View Gramplet panel, and Cancel can just
// terminate it) and everything about its run: the context captured when it
// starts, progress, and the result. Runs as soon as it opens; a Gramplet
// that wants input first asks for it with its own st.* widgets (and does
// its real work behind an st.button), same as in the View Gramplet panel.
// store/grampletWindows.ts only holds what windows share (open/minimized/
// stacking/running).
//
// Stays mounted while minimized -- only hidden, with a chip in the bottom
// dock standing in for it -- so a run carries on in the background and
// the rendered result (including any st.* widget's half-typed input) is
// still there when it's restored.
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Alert, Box, Button, Group, Loader, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken } from "../auth/auth";
import { CircleGlyphButton } from "../components/CircleGlyphButton";
import { t } from "../i18n/i18n";
import { confirmDialog } from "../store/confirmDialog";
import { getHomePersonHandle } from "../store/homePersonPreference";
import { readMainViewContext } from "./grampletContext";
import { canAuthorGramplets } from "./grampletMedia";
import { GrampletResultView, type RunStatus } from "./GrampletResultView";
import {
  closeGrampletWindow, focusGrampletWindow, forgetWorker, GRAMPLET_CHIP_WIDTH, markWorkerIdle, setGrampletRunning,
  restartGrampletWindow, setGrampletWindowMinimized, type GrampletWindowEntry,
} from "../store/grampletWindows";
import type { GrampletOutputResponse, PyodideWorkerResponse, RunGrampletRequest } from "./types";

// Pulls in prismjs/react-simple-code-editor -- lazy, like every other
// GrampletEditDialog opener, so a window that's never edited never loads it.
const GrampletEditDialog = lazy(() => import("./GrampletEditDialog").then((m) => ({ default: m.GrampletEditDialog })));

const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
/** How far each further window is offset from the previous one when no
 * position of its own was remembered. */
const CASCADE_STEP = 28;
/** How often a running window re-checks its login token (getToken()
 * refreshes it when it's close to expiring) and hands a changed one to its
 * worker -- see SetTokenRequest in types.ts. */
const TOKEN_REFRESH_MS = 60_000;

interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Per Gramplet, per browser -- the same localStorage convention as the
// View Gramplet panel's own height (PyodidePocPanel.tsx).
function geometryStorageKey(grampletId: string): string {
  return `gramps-connect:grampletWindowGeometry:${grampletId}`;
}

/** Keeps at least the title bar on screen, after a browser resize or a
 * position remembered from a bigger screen. */
function clampGeometry(g: Geometry): Geometry {
  const width = Math.max(MIN_WIDTH, Math.min(g.width, window.innerWidth - 16));
  const height = Math.max(MIN_HEIGHT, Math.min(g.height, window.innerHeight - 16));
  return {
    width,
    height,
    left: Math.max(8 - width + 120, Math.min(g.left, window.innerWidth - 120)),
    top: Math.max(8, Math.min(g.top, window.innerHeight - 40)),
  };
}

function initialGeometry(grampletId: string, cascadeIndex: number): Geometry {
  try {
    const raw = localStorage.getItem(geometryStorageKey(grampletId));
    if (raw) {
      const g = JSON.parse(raw) as Geometry;
      if ([g.left, g.top, g.width, g.height].every(Number.isFinite)) return clampGeometry(g);
    }
  } catch {
    // Unreadable/unavailable storage -- fall through to the default.
  }
  const offset = cascadeIndex * CASCADE_STEP;
  return clampGeometry({
    left: window.innerWidth - DEFAULT_WIDTH - 24 - offset,
    top: window.innerHeight - DEFAULT_HEIGHT - 72 - offset,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
}

function storeGeometry(grampletId: string, g: Geometry): void {
  try {
    localStorage.setItem(geometryStorageKey(grampletId), JSON.stringify(g));
  } catch {
    // Not worth surfacing -- the window just opens at its default next time.
  }
}

interface RunProgress {
  done: number;
  total: number | null;
  message: string;
}

export function GrampletWindow({
  entry,
  zIndex,
  chipRight,
  cascadeIndex,
}: {
  entry: GrampletWindowEntry;
  zIndex: number;
  /** This window's chip's offset from the right edge while minimized (its
   * place in the shared bottom dock). */
  chipRight: number;
  /** Its position among open windows, for the default cascade. */
  cascadeIndex: number;
}) {
  const { gramplet, minimized } = entry;
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [response, setResponse] = useState<GrampletOutputResponse | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [stopped, setStopped] = useState(false);
  const [geometry, setGeometry] = useState<Geometry>(() => initialGeometry(gramplet.id, cascadeIndex));
  const [maximized, setMaximized] = useState(false);
  const [editing, setEditing] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const activeRunIdRef = useRef("");
  const lastRequestRef = useRef<RunGrampletRequest | null>(null);
  const tokenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;
  const paperRef = useRef<HTMLDivElement | null>(null);

  const running = runStatus === "queued" || runStatus === "loading";

  function stopTokenRefresh() {
    if (tokenTimerRef.current !== null) clearInterval(tokenTimerRef.current);
    tokenTimerRef.current = null;
  }

  function releaseWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
  }

  // Closing the window (or the whole page section unmounting) ends
  // everything this window started.
  useEffect(
    () => () => {
      releaseWorker();
      stopTokenRefresh();
      setGrampletRunning(gramplet.id, false);
      forgetWorker(gramplet.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function notifyFinished(ok: boolean) {
    if (!minimizedRef.current) return;
    const id = `gramplet-finished-${gramplet.id}`;
    notifications.show({
      id,
      color: ok ? "green" : "red",
      title: gramplet.label,
      message: (
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="sm">{ok ? t("Finished") : t("Stopped with an error")}</Text>
          <Button
            size="compact-xs"
            variant="light"
            onClick={() => {
              setGrampletWindowMinimized(gramplet.id, false);
              notifications.hide(id);
            }}
          >
            {t("Show")}
          </Button>
        </Group>
      ),
    });
  }

  function finishRun() {
    stopTokenRefresh();
    setGrampletRunning(gramplet.id, false);
    markWorkerIdle(gramplet.id, releaseWorker);
  }

  function getWorker(): Worker {
    if (!workerRef.current) {
      const worker = new Worker(new URL("./pyodideWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<PyodideWorkerResponse>) => {
        const data = event.data;
        // A run that was cancelled or superseded -- this window has moved on.
        if (data.runId !== activeRunIdRef.current) return;
        if (data.type === "started") {
          setRunStatus("loading");
        } else if (data.type === "run-progress") {
          setProgress({ done: data.done, total: data.total, message: data.message });
        } else if (data.type === "progress") {
          setResponse(data);
        } else {
          setRunStatus(data.type === "error" ? "error" : "done");
          setResponse(data);
          finishRun();
          notifyFinished(data.type !== "error");
        }
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }

  async function postRun(request: Omit<RunGrampletRequest, "token" | "runId">) {
    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    setStopped(false);
    setRunStatus("queued");
    setGrampletRunning(gramplet.id, true);
    forgetWorker(gramplet.id);
    let token: string;
    try {
      token = await getToken();
    } catch (err) {
      setRunStatus("error");
      setResponse({ type: "error", text: err instanceof Error ? err.message : String(err), blocks: [], runId });
      setGrampletRunning(gramplet.id, false);
      return;
    }
    if (activeRunIdRef.current !== runId) return; // Cancelled while getting the token.
    const full: RunGrampletRequest = { ...request, token, runId };
    lastRequestRef.current = full;
    const worker = getWorker();
    worker.postMessage(full);
    stopTokenRefresh();
    let lastToken = token;
    tokenTimerRef.current = setInterval(async () => {
      try {
        const fresh = await getToken();
        if (fresh !== lastToken && workerRef.current === worker) {
          lastToken = fresh;
          worker.postMessage({ type: "set-token", token: fresh });
        }
      } catch (err) {
        console.warn("[gramplet window] token refresh failed", err);
      }
    }, TOKEN_REFRESH_MS);
  }

  /** The window's one fresh run, when it opens, reading the main view's
   * context *now*: get_selected()
   * and get_filter() see whichever object-type list is open behind the
   * window (nothing, if it isn't a list), and keep seeing that for the
   * whole run even if you navigate elsewhere meanwhile. */
  function handleRun() {
    const ctx = readMainViewContext();
    setResponse(null);
    setProgress(null);
    void postRun({
      type: "run-gramplet",
      code: gramplet.code,
      grampletId: gramplet.id,
      selectedType: ctx.selectedHandle ? ctx.viewKey : null,
      selectedHandle: ctx.selectedHandle,
      whereExpr: ctx.whereExpr,
      filterType: ctx.whereExpr ? ctx.viewKey : null,
      homePersonHandle: getHomePersonHandle(),
    });
  }

  // Opening the window runs it, the same as switching to a View Gramplet's
  // tab does.
  useEffect(() => {
    handleRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** An st.* widget click: the same run again (same context),
   * plus which widget changed. Keeps the current result on screen while it
   * reruns, same as the panel does. */
  function handleWidgetEvent(key: string, value: unknown) {
    const last = lastRequestRef.current;
    if (!last) return;
    const { token: _token, runId: _runId, ...request } = last;
    void postRun({ ...request, widgetEvent: { key, value } });
  }

  function handleCancel() {
    releaseWorker();
    activeRunIdRef.current = "";
    stopTokenRefresh();
    setGrampletRunning(gramplet.id, false);
    forgetWorker(gramplet.id);
    // Keep whatever it had printed so far: the last mid-run snapshot,
    // recast as a finished result (GrampletResultView only shows a
    // finished run's own `blocks`).
    setResponse((r) => (r?.type === "progress" ? { type: "blocks", blocks: r.blocks, runId: r.runId } : r));
    setRunStatus("done");
    setStopped(true);
  }

  async function handleClose() {
    if (running) {
      const ok = await confirmDialog(t("Stop this Gramplet and close its window?"), t("Stop"));
      if (!ok) return;
    }
    closeGrampletWindow(gramplet.id);
  }

  // Dragging by the title bar. Pointer capture keeps the drag going even
  // when the pointer outruns the window.
  const dragRef = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);
  function onTitlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (maximized || e.button !== 0 || (e.target as HTMLElement).closest("button, [role=button]")) return;
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, left: geometry.left, top: geometry.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onTitlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setGeometry((g) =>
      clampGeometry({ ...g, left: drag.left + e.clientX - drag.pointerX, top: drag.top + e.clientY - drag.pointerY })
    );
  }
  function onTitlePointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setGeometry((g) => {
      storeGeometry(gramplet.id, g);
      return g;
    });
  }

  // The browser's own resize handle (CSS `resize: both`) changes the
  // element's size directly; this mirrors that back into state (so the next
  // render doesn't snap it back) and remembers it.
  useEffect(() => {
    const el = paperRef.current;
    if (!el || maximized || minimized) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      setGeometry((g) => {
        if (Math.abs(g.width - width) < 1 && Math.abs(g.height - height) < 1) return g;
        const next = { ...g, width, height };
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => storeGeometry(gramplet.id, next), 300);
        return next;
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [gramplet.id, maximized, minimized]);

  const percent = progress && progress.total ? Math.min(100, (progress.done / progress.total) * 100) : null;

  const statusGlyph = running ? null : stopped ? t("Stopped") : runStatus === "done" ? "✓" : runStatus === "error" ? "⚠" : null;

  return (
    <>
      {minimized && (
        <Paper
          withBorder
          shadow="md"
          radius="sm"
          style={{ position: "fixed", bottom: 0, right: chipRight, width: GRAMPLET_CHIP_WIDTH, zIndex }}
        >
          <Group gap={6} wrap="nowrap" px="sm" py={6} style={{ background: "var(--mantine-color-default-hover)" }}>
            <UnstyledButton
              onClick={() => setGrampletWindowMinimized(gramplet.id, false)}
              style={{ minWidth: 0, flex: 1 }}
              title={t("Show")}
            >
              <Group gap={6} wrap="nowrap">
                <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                  {gramplet.label}
                </Text>
                {running &&
                  (percent !== null ? <Text size="xs">{Math.floor(percent)}%</Text> : <Loader size={12} />)}
                {statusGlyph && (
                  <Text size="xs" c={runStatus === "error" ? "red" : "dimmed"}>
                    {statusGlyph}
                  </Text>
                )}
              </Group>
            </UnstyledButton>
            <CircleGlyphButton glyph="▴" label={t("Show")} onClick={() => setGrampletWindowMinimized(gramplet.id, false)} size={18} />
            <CircleGlyphButton glyph="×" label={t("Close")} onClick={() => void handleClose()} size={18} />
          </Group>
        </Paper>
      )}
      <Paper
        ref={paperRef}
        withBorder
        shadow="lg"
        radius="sm"
        onPointerDownCapture={() => focusGrampletWindow(gramplet.id)}
        style={{
          position: "fixed",
          zIndex,
          display: minimized ? "none" : "flex",
          flexDirection: "column",
          overflow: "hidden",
          ...(maximized
            ? { left: "3vw", top: "3vh", width: "94vw", height: "94vh" }
            : {
                left: geometry.left,
                top: geometry.top,
                width: geometry.width,
                height: geometry.height,
                resize: "both",
                minWidth: MIN_WIDTH,
                minHeight: MIN_HEIGHT,
              }),
        }}
      >
        <Group
          gap={6}
          wrap="nowrap"
          justify="space-between"
          px="sm"
          py={6}
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
          onPointerCancel={onTitlePointerUp}
          onDoubleClick={() => setMaximized((m) => !m)}
          style={{
            flex: "none",
            cursor: maximized ? undefined : "move",
            userSelect: "none",
            touchAction: "none",
            background: "var(--mantine-color-default-hover)",
            borderBottom: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <Text fw={600} size="sm" truncate style={{ minWidth: 0, flex: 1 }}>
            {gramplet.label}
          </Text>
          <Group gap={2} wrap="nowrap">
            {canAuthorGramplets() && gramplet.handle && (
              <CircleGlyphButton glyph="✎" label={t("Edit Gramplet")} onClick={() => setEditing(true)} size={18} />
            )}
            <CircleGlyphButton glyph="▾" label={t("Minimize")} onClick={() => setGrampletWindowMinimized(gramplet.id, true)} size={18} />
            <CircleGlyphButton
              glyph={maximized ? "⤡" : "⤢"}
              label={maximized ? t("Restore size") : t("Maximize")}
              onClick={() => setMaximized((m) => !m)}
              size={18}
            />
            <CircleGlyphButton glyph="×" label={t("Close")} onClick={() => void handleClose()} size={18} />
          </Group>
        </Group>
        <Box p="sm" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Stack gap="sm">
            {/* The Gramplet's own st.progress() bar (if any) is part of its
                output below; this row just says it's still going. */}
            {running && (
              <Group justify="space-between" wrap="nowrap" align="center">
                <Group gap={6} wrap="nowrap">
                  <Loader size={12} />
                  <Text size="xs" c="dimmed">
                    {runStatus === "queued" ? t("Starting…") : t("Running…")}
                  </Text>
                </Group>
                <Button size="xs" variant="default" color="red" onClick={handleCancel}>
                  {t("Cancel")}
                </Button>
              </Group>
            )}
            {stopped && (
              <Alert color="gray" py={6}>
                {t("Stopped before it finished -- what's below is what it had produced so far.")}
              </Alert>
            )}
            {runStatus !== "idle" && (
              <GrampletResultView status={runStatus} response={response} onWidgetEvent={handleWidgetEvent} />
            )}
          </Stack>
        </Box>
      </Paper>
      {/* Saving restarts this window with the saved version (a fresh mount
          -- see restartGrampletWindow()), which unmounts this dialog too. */}
      {editing && gramplet.handle && (
        <Suspense fallback={null}>
          <GrampletEditDialog
            target={{ kind: "edit", handle: gramplet.handle }}
            onClose={() => setEditing(false)}
            onSaved={(saved) => restartGrampletWindow({ ...saved, handle: gramplet.handle })}
          />
        </Suspense>
      )}
    </>
  );
}
