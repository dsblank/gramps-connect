// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import type { MainViewContext } from "../grampletContext";
import type { Gramplet, PyodideWorkerResponse, RunGrampletRequest } from "../types";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn(async () => "tok"), hasPermissions: vi.fn(() => true) }));
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
} from "../grampletWindows";

const GRAMPLET: Gramplet = { id: "g1", label: "Counter", code: "print(get_filter())", kind: "window" };

function renderWindow(gramplet: Gramplet = GRAMPLET) {
  openGrampletWindow(gramplet);
  const entry = getGrampletWindows().find((e) => e.gramplet.id === gramplet.id)!;
  return renderWithProviders(<GrampletWindow entry={entry} zIndex={150} chipRight={16} cascadeIndex={0} />);
}

/** Lets postRun()'s `await getToken()` settle. */
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
      token: "tok",
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
});
