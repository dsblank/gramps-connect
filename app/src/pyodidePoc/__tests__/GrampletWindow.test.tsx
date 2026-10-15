// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import type { MainViewContext } from "../grampletContext";
import type { Gramplet, PyodideWorkerResponse, RunGrampletRequest } from "../types";

const auth = vi.hoisted(() => ({
  getToken: vi.fn(async () => "tok"),
  refreshTokenNow: vi.fn(async () => "fresh"),
  hasPermissions: vi.fn(() => true),
}));
vi.mock("../../auth/auth", () => auth);
const commit = vi.hoisted(() => ({
  canChangeData: vi.fn(() => true),
  commitChangeGroup: vi.fn(async (message: string, items: unknown[]) => ({ message, transaction: items })),
  undoCommittedGroups: vi.fn(async () => {}),
}));
vi.mock("../grampletCommit", () => commit);
vi.mock("../../store/homePersonPreference", () => ({ getHomePersonHandle: vi.fn(() => "HOME") }));
let context: MainViewContext;
vi.mock("../grampletContext", () => ({
  readMainViewContext: () => context,
}));

/** A worker response minus its runId -- distributive, so each variant keeps its own fields. */
type Reply = PyodideWorkerResponse extends infer R ? (R extends unknown ? Omit<R, "runId"> : never) : never;

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<PyodideWorkerResponse>) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  /** The last run request posted. */
  get lastRun(): RunGrampletRequest {
    return this.posted.filter((m) => (m as { type: string }).type === "run-gramplet").slice(-1)[0] as RunGrampletRequest;
  }
  emit(message: Reply, runId = this.lastRun.runId) {
    act(() => this.onmessage?.({ data: { ...message, runId } } as MessageEvent<PyodideWorkerResponse>));
  }
}
vi.stubGlobal("Worker", FakeWorker);
// The real editor pulls in prismjs; this stand-in just saves an edit.
vi.mock("../GrampletEditDialog", () => ({
  GrampletEditDialog: ({ onSaved, onClose }: { onSaved: (g: Gramplet) => void; onClose: () => void }) => (
    <button
      onClick={() => {
        onSaved({ id: "g4", label: "Counter", code: "print('edited')", kind: "window" });
        onClose();
      }}
    >
      fake save
    </button>
  ),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  }
);

import { GrampletWindow } from "../GrampletWindow";
import { GrampletWindows } from "../GrampletWindows";
import {
  closeGrampletWindow, getGrampletWindows, isAnyGrampletRunning, openGrampletWindow, setGrampletWindowMinimized,
} from "../../store/grampletWindows";

const GRAMPLET: Gramplet = { id: "g1", label: "Counter", code: "print(get_filter())", kind: "window" };

function renderWindow(gramplet: Gramplet = GRAMPLET) {
  openGrampletWindow(gramplet);
  const entry = getGrampletWindows().find((e) => e.gramplet.id === gramplet.id)!;
  return renderWithProviders(<GrampletWindow entry={entry} zIndex={150} chipRight={16} cascadeIndex={0} />);
}

/** Lets pending promises (a token or commit answer) settle. */
async function flush() {
  await act(async () => {});
}

describe("GrampletWindow", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    context = { viewKey: "person", viewLabel: "People", selectedHandle: "SEL", whereExpr: "gender == 1", filteredCount: 12 };
  });

  it("runs as soon as it opens, against the main view's context, and shows progress then the result", async () => {
    const { rerender } = renderWindow();
    // As GrampletWindows.tsx would, after a store change.
    const rerenderFromStore = () =>
      rerender(<GrampletWindow entry={getGrampletWindows().find((e) => e.gramplet.id === "g1")!} zIndex={150} chipRight={16} cascadeIndex={0} />);
    await flush();

    const worker = FakeWorker.instances[0];
    expect(worker.lastRun).toMatchObject({
      type: "run-gramplet",
      code: "print(get_filter())",
      grampletId: "g1",
      selectedType: "person",
      selectedHandle: "SEL",
      whereExpr: "gender == 1",
      homePersonHandle: "HOME",
    });
    expect(isAnyGrampletRunning()).toBe(true);

    worker.emit({ type: "started" });
    expect(screen.getByText("Running…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    // st.progress()'s value shows on the minimized chip.
    worker.emit({ type: "run-progress", done: 50, total: 100, message: "Halfway" });
    setGrampletWindowMinimized("g1", true);
    rerenderFromStore();
    expect(screen.getByText("50%")).toBeTruthy();
    setGrampletWindowMinimized("g1", false);
    rerenderFromStore();

    worker.emit({ type: "blocks", blocks: [{ type: "html", markup: "<pre>all done</pre>" }] });
    expect(screen.getByText("all done")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(isAnyGrampletRunning()).toBe(false);
  });

  it("answers the worker's token requests, even for a run a newer one replaced", async () => {
    renderWindow({ ...GRAMPLET, id: "g5" });
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker.lastRun).not.toHaveProperty("token");
    const tokenResults = () => worker.posted.filter((m) => (m as { type: string }).type === "token-result");

    worker.emit({ type: "need-token", requestId: "t1", force: false });
    await flush();
    expect(tokenResults()).toEqual([{ type: "token-result", requestId: "t1", ok: true, token: "tok" }]);

    // After a 401: a forced refresh, answered for a stale run too.
    worker.emit({ type: "need-token", requestId: "t2", force: true }, "stale-run");
    await flush();
    expect(auth.refreshTokenNow).toHaveBeenCalled();
    expect(tokenResults()[1]).toEqual({ type: "token-result", requestId: "t2", ok: true, token: "fresh" });

    // The session itself has ended.
    auth.getToken.mockRejectedValueOnce(new Error("not logged in"));
    worker.emit({ type: "need-token", requestId: "t3", force: false });
    await flush();
    expect(tokenResults()[2]).toEqual({ type: "token-result", requestId: "t3", ok: false, error: "not logged in" });
  });

  it("a widget click reruns with the run's own context, not whatever the main view shows now", async () => {
    const user = userEvent.setup();
    renderWindow({ ...GRAMPLET, id: "g2" });
    await flush();
    const worker = FakeWorker.instances[0];
    const html = '<button data-gramplet-key="go" data-gramplet-event="click">Go</button>';
    worker.emit({ type: "blocks", blocks: [{ type: "html", markup: html }] });
    expect(screen.queryByRole("button", { name: "Run again" })).toBeNull();

    context = { viewKey: "family", viewLabel: "Families", selectedHandle: "F1", whereExpr: "x", filteredCount: 1 };
    await user.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    expect(worker.lastRun).toMatchObject({
      selectedType: "person",
      selectedHandle: "SEL",
      whereExpr: "gender == 1",
      widgetEvent: { key: "go" },
    });
  });

  it("Cancel stops the worker, keeps what was produced, and ignores anything the old run still sends", async () => {
    const user = userEvent.setup();
    renderWindow({ ...GRAMPLET, id: "g3" });
    await flush();
    const worker = FakeWorker.instances[0];
    const oldRunId = worker.lastRun.runId;
    const partial = '<pre>partial</pre><button data-gramplet-key="go" data-gramplet-event="click">Go</button>';
    worker.emit({ type: "progress", blocks: [{ type: "html", markup: partial }] });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(worker.terminated).toBe(true);
    expect(screen.getByText(/Stopped before it finished/)).toBeTruthy();
    expect(screen.getByText("partial")).toBeTruthy();
    expect(isAnyGrampletRunning()).toBe(false);

    worker.emit({ type: "blocks", blocks: [{ type: "html", markup: "<pre>too late</pre>" }] }, oldRunId);
    expect(screen.queryByText("too late")).toBeNull();

    // A widget in what was kept still works -- on a fresh worker.
    await user.click(screen.getByRole("button", { name: "Go" }));
    await flush();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].lastRun.widgetEvent).toMatchObject({ key: "go" });
  });

  it("the edit pencil saves and restarts the window with the edited code", async () => {
    const user = userEvent.setup();
    for (const entry of getGrampletWindows()) closeGrampletWindow(entry.gramplet.id);
    openGrampletWindow({ ...GRAMPLET, id: "g4", handle: "M4" });
    renderWithProviders(<GrampletWindows />);
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    const first = FakeWorker.instances[0];

    await user.click(screen.getByRole("button", { name: "Edit Gramplet" }));
    await user.click(await screen.findByRole("button", { name: "fake save" }));
    await flush();

    expect(first.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].lastRun.code).toBe("print('edited')");
  });

  describe("with Allow data changes", () => {
    const CHANGER: Gramplet = { ...GRAMPLET, id: "c1", allowChanges: true };
    const ITEMS = [{ type: "update" as const, _class: "Person", handle: "H", old: {}, new: {} }];

    beforeEach(() => {
      // At most five windows can be open.
      for (const entry of getGrampletWindows()) closeGrampletWindow(entry.gramplet.id);
      commit.canChangeData.mockReturnValue(true);
      commit.commitChangeGroup.mockClear();
      commit.undoCommittedGroups.mockClear();
    });

    it("opens with a dry run; Run saves each group the worker sends, and Undo takes them back", async () => {
      const user = userEvent.setup();
      renderWindow(CHANGER);
      await flush();
      const worker = FakeWorker.instances[0];
      expect(worker.lastRun).toMatchObject({ allowChanges: true, dryRun: true, grampletLabel: "Counter" });
      worker.emit({ type: "blocks", blocks: [] });
      expect(screen.queryByText("Saving changes")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Run" }));
      await flush();
      expect(worker.lastRun).toMatchObject({ dryRun: false });
      worker.emit({ type: "commit-changes", requestId: "r1", message: "Fix", items: ITEMS });
      await flush();
      expect(commit.commitChangeGroup).toHaveBeenCalledWith("Fix", ITEMS);
      expect(worker.posted.slice(-1)[0]).toEqual({ type: "commit-result", requestId: "r1", ok: true });
      worker.emit({ type: "blocks", blocks: [] });
      expect(screen.getByText("Saving changes")).toBeTruthy();
      expect(screen.getByText("Saved groups of changes: 1")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(commit.undoCommittedGroups).toHaveBeenCalledWith([{ message: "Fix", transaction: ITEMS }]);
      expect(await screen.findByText("Undone.")).toBeTruthy();
    });

    it("passes a refused save back to the run", async () => {
      renderWindow({ ...CHANGER, id: "c2" });
      await flush();
      const worker = FakeWorker.instances[0];
      commit.commitChangeGroup.mockRejectedValueOnce(new Error("One of these records was changed"));
      worker.emit({ type: "commit-changes", requestId: "r2", message: "Fix", items: ITEMS });
      await flush();
      expect(worker.posted.slice(-1)[0]).toEqual({
        type: "commit-result",
        requestId: "r2",
        ok: false,
        error: "One of these records was changed",
      });
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });

    it("refuses to save for a run a newer one replaced", async () => {
      const user = userEvent.setup();
      renderWindow({ ...CHANGER, id: "c3" });
      await flush();
      const worker = FakeWorker.instances[0];
      const oldRunId = worker.lastRun.runId;
      worker.emit({ type: "blocks", blocks: [] });
      await user.click(screen.getByRole("button", { name: "Dry run" }));
      await flush();
      worker.emit({ type: "commit-changes", requestId: "r3", message: "Fix", items: ITEMS }, oldRunId);
      expect(commit.commitChangeGroup).not.toHaveBeenCalled();
      expect(worker.posted.slice(-1)[0]).toMatchObject({ type: "commit-result", requestId: "r3", ok: false });
    });

    it("disables Run without Editor rights, but still allows a dry run", async () => {
      commit.canChangeData.mockReturnValue(false);
      renderWindow({ ...CHANGER, id: "c4" });
      await flush();
      FakeWorker.instances[0].emit({ type: "blocks", blocks: [] });
      expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Dry run" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("has no Run/Dry run buttons without it", async () => {
      renderWindow({ ...GRAMPLET, id: "c5" });
      await flush();
      FakeWorker.instances[0].emit({ type: "blocks", blocks: [] });
      expect(screen.queryByRole("button", { name: "Dry run" })).toBeNull();
    });
  });
});
