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
// The window itself (drag, resize, minimize to the bottom dock) is the
// shared components/FloatingWindow.tsx. It stays mounted while minimized,
// so a run carries on in the background and the rendered result
// (including any st.* widget's half-typed input) is still there when it's
// restored.
//
// A Gramplet with Allow data changes gets Dry run and Run buttons (see
// GRAMPLET_WRITES_PLAN.md): opening it does a dry run; Run saves each group
// of changes as the code closes it (commit-changes messages from the
// worker, saved by grampletCommit.ts), and Undo takes back everything the
// current result saved.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { CircleGlyphButton } from "../components/CircleGlyphButton";
import { FloatingWindow } from "../components/FloatingWindow";
import { t } from "../i18n/i18n";
import { confirmDialog } from "../store/confirmDialog";
import { getHomePersonHandle } from "../store/homePersonPreference";
import { readMainViewContext } from "./grampletContext";
import { grampletKind } from "./grampletManifest";
import { canChangeData, commitChangeGroup, undoCommittedGroups, type CommittedGroup } from "./grampletCommit";
import { canAuthorGramplets } from "./grampletMedia";
import { GrampletResultView, type RunStatus } from "./GrampletResultView";
import {
  closeGrampletWindow, focusGrampletWindow, forgetWorker, GRAMPLET_CHIP_WIDTH, markWorkerIdle, setGrampletRunning,
  restartGrampletWindow, setGrampletWindowMinimized, type GrampletWindowEntry,
} from "../store/grampletWindows";
import type { GrampletOutputResponse, PyodideWorkerResponse, RunGrampletRequest } from "./types";
import { answerTokenRequest } from "./workerToken";
import { grampletWindowGeometryKey } from "../store/storageKeys";

// Pulls in prismjs/react-simple-code-editor -- lazy, like every other
// GrampletEditDialog opener, so a window that's never edited never loads it.
const GrampletEditDialog = lazy(() => import("./GrampletEditDialog").then((m) => ({ default: m.GrampletEditDialog })));

// Per Gramplet, per browser -- the same localStorage convention as the
// View Gramplet panel's own height (PyodidePocPanel.tsx).
function geometryStorageKey(grampletId: string): string {
  return grampletWindowGeometryKey(grampletId);
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
  const [editing, setEditing] = useState(false);
  // What the current result's real run saved, for Undo -- and Undo's own
  // progress. Only ever non-empty for a Gramplet with Allow data changes.
  const [saved, setSaved] = useState<CommittedGroup[]>([]);
  const [undo, setUndo] = useState<{ state: "idle" | "undoing" | "undone" } | { state: "error"; error: string }>({
    state: "idle",
  });
  const allowChanges = grampletKind(gramplet) === "window" && gramplet.allowChanges === true;

  const workerRef = useRef<Worker | null>(null);
  const activeRunIdRef = useRef("");
  const lastRequestRef = useRef<RunGrampletRequest | null>(null);
  // The run `saved` belongs to. A commit that was already on its way when
  // the run was cancelled still lands here (it did get saved), but one from
  // a run a newer run has replaced is refused instead.
  const savedForRunRef = useRef<{ runId: string; groups: CommittedGroup[] }>({ runId: "", groups: [] });
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;

  const running = runStatus === "queued" || runStatus === "loading";

  function releaseWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
  }

  // Closing the window (or the whole page section unmounting) ends
  // everything this window started.
  useEffect(
    () => () => {
      releaseWorker();
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
    setGrampletRunning(gramplet.id, false);
    markWorkerIdle(gramplet.id, releaseWorker);
  }

  function getWorker(): Worker {
    if (!workerRef.current) {
      const worker = new Worker(new URL("./pyodideWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<PyodideWorkerResponse>) => {
        const data = event.data;
        if (answerTokenRequest(worker, data)) return;
        if (data.type === "commit-changes") {
          handleCommit(worker, data.runId, data.requestId, data.message, data.items);
          return;
        }
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

  /** A real run closed a group of changes: save it, then tell the worker
   * how that went -- the run is waiting on the answer. */
  function handleCommit(worker: Worker, runId: string, requestId: string, message: string, items: CommittedGroup["transaction"]) {
    const answer = (result: { ok: true } | { ok: false; error: string }) =>
      worker.postMessage({ type: "commit-result", requestId, ...result });
    if (runId !== savedForRunRef.current.runId || runId !== activeRunIdRef.current) {
      answer({ ok: false, error: "This run was replaced by a newer one, so its changes weren't saved." });
      return;
    }
    commitChangeGroup(message, items).then(
      (group) => {
        if (savedForRunRef.current.runId === runId) {
          savedForRunRef.current.groups.push(group);
          setSaved([...savedForRunRef.current.groups]);
        }
        answer({ ok: true });
      },
      (err: unknown) => answer({ ok: false, error: err instanceof Error ? err.message : String(err) })
    );
  }

  async function handleUndo() {
    setUndo({ state: "undoing" });
    try {
      await undoCommittedGroups(saved);
      setUndo({ state: "undone" });
    } catch (err) {
      setUndo({ state: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  function postRun(request: Omit<RunGrampletRequest, "runId">) {
    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    savedForRunRef.current = { runId, groups: [] };
    setSaved([]);
    setUndo({ state: "idle" });
    setStopped(false);
    setRunStatus("queued");
    setGrampletRunning(gramplet.id, true);
    forgetWorker(gramplet.id);
    const full: RunGrampletRequest = { ...request, runId };
    lastRequestRef.current = full;
    getWorker().postMessage(full);
  }

  /** The window's one fresh run, when it opens, reading the main view's
   * context *now*: get_selected()
   * and get_filter() see whichever object-type list is open behind the
   * window (nothing, if it isn't a list), and keep seeing that for the
   * whole run even if you navigate elsewhere meanwhile. */
  function handleRun(dryRun = true) {
    const ctx = readMainViewContext();
    setResponse(null);
    setProgress(null);
    postRun({
      type: "run-gramplet",
      code: gramplet.code,
      grampletId: gramplet.id,
      selectedType: ctx.selectedHandle ? ctx.viewKey : null,
      selectedHandle: ctx.selectedHandle,
      whereExpr: ctx.whereExpr,
      filterType: ctx.whereExpr ? ctx.viewKey : null,
      homePersonHandle: getHomePersonHandle(),
      allowChanges,
      // Opening the window is always a dry run; only the Run button saves.
      dryRun,
      grampletLabel: gramplet.label,
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
    const { runId: _runId, ...request } = last;
    postRun({ ...request, widgetEvent: { key, value } });
  }

  function handleCancel() {
    releaseWorker();
    activeRunIdRef.current = "";
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

  const percent = progress && progress.total ? Math.min(100, (progress.done / progress.total) * 100) : null;

  const statusGlyph = running ? null : stopped ? t("Stopped") : runStatus === "done" ? "✓" : runStatus === "error" ? "⚠" : null;

  return (
    <>
      <FloatingWindow
        storageKey={geometryStorageKey(gramplet.id)}
        title={gramplet.label}
        zIndex={zIndex}
        minimized={minimized}
        chipRight={chipRight}
        chipWidth={GRAMPLET_CHIP_WIDTH}
        cascadeIndex={cascadeIndex}
        onFocus={() => focusGrampletWindow(gramplet.id)}
        onMinimize={(m) => setGrampletWindowMinimized(gramplet.id, m)}
        onClose={() => void handleClose()}
        chipStatus={
          <>
            {running && (percent !== null ? <Text size="xs">{Math.floor(percent)}%</Text> : <Loader size={12} />)}
            {statusGlyph && (
              <Text size="xs" c={runStatus === "error" ? "red" : "dimmed"}>
                {statusGlyph}
              </Text>
            )}
          </>
        }
        titleExtra={
          allowChanges &&
          lastRequestRef.current?.dryRun === false &&
          runStatus !== "idle" && (
            <Badge size="xs" color="red" variant="filled" style={{ flex: "none" }}>
              {t("Saving changes")}
            </Badge>
          )
        }
        headerButtons={
          canAuthorGramplets() &&
          gramplet.handle && (
            <CircleGlyphButton glyph="✎" label={t("Edit Gramplet")} onClick={() => setEditing(true)} size={18} />
          )
        }
      >
          <Stack gap="sm">
            {allowChanges && (
              <Group gap="xs" wrap="nowrap">
                <Button size="xs" variant="default" onClick={() => handleRun(true)} disabled={running}>
                  {t("Dry run")}
                </Button>
                <Tooltip
                  label={t("Saving changes needs Editor rights or above.")}
                  disabled={canChangeData()}
                  withArrow
                >
                  {/* A disabled button gets no pointer events, so the tooltip
                      needs a wrapper to hang on. */}
                  <span>
                    <Button
                      size="xs"
                      color="red"
                      onClick={() => handleRun(false)}
                      disabled={running || !canChangeData()}
                    >
                      {t("Run")}
                    </Button>
                  </span>
                </Tooltip>
                <Text size="xs" c="dimmed">
                  {t("Changes data. Dry run shows what it would change; Run saves it.")}
                </Text>
              </Group>
            )}
            {saved.length > 0 && (
              <Group gap="xs" wrap="nowrap" justify="space-between">
                <Text size="xs" c={undo.state === "error" ? "red" : undefined}>
                  {undo.state === "undone"
                    ? t("Undone.")
                    : undo.state === "error"
                      ? `${t("Undo failed:")} ${undo.error}`
                      : `${t("Saved groups of changes:")} ${saved.length}`}
                </Text>
                {undo.state !== "undone" && (
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => void handleUndo()}
                    loading={undo.state === "undoing"}
                    disabled={running}
                  >
                    {t("Undo")}
                  </Button>
                )}
              </Group>
            )}
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
      </FloatingWindow>
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
