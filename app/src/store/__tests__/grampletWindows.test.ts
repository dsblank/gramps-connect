import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as GrampletWindows from "../grampletWindows";
import type * as BottomDock from "../bottomDock";
import type { Gramplet } from "../../pyodidePoc/types";

let w: typeof GrampletWindows;
let dockModule: typeof BottomDock;

function gramplet(id: string, overrides: Partial<Gramplet> = {}): Gramplet {
  return { id, label: id, code: "", kind: "window", ...overrides };
}

describe("grampletWindows", () => {
  beforeEach(async () => {
    vi.resetModules();
    w = await import("../grampletWindows");
    dockModule = await import("../bottomDock");
  });

  it("opens one window per Gramplet, focusing (and refreshing) an already-open one", () => {
    expect(w.openGrampletWindow(gramplet("a"))).toBe("opened");
    expect(w.openGrampletWindow(gramplet("b"))).toBe("opened");
    expect(w.getGrampletWindowZOrder()).toEqual(["a", "b"]);
    expect(w.openGrampletWindow(gramplet("a", { code: "edited" }))).toBe("focused");
    expect(w.getGrampletWindows().map((e) => e.gramplet.id)).toEqual(["a", "b"]);
    expect(w.getGrampletWindows()[0].gramplet.code).toBe("edited");
    expect(w.getGrampletWindowZOrder()).toEqual(["b", "a"]);
  });

  it("refuses a window past the cap instead of closing an old one", () => {
    for (let i = 0; i < w.MAX_GRAMPLET_WINDOWS; i++) w.openGrampletWindow(gramplet(`g${i}`));
    expect(w.openGrampletWindow(gramplet("extra"))).toBe("full");
    expect(w.getGrampletWindows()).toHaveLength(w.MAX_GRAMPLET_WINDOWS);
    // An already-open one can still be focused when full.
    expect(w.openGrampletWindow(gramplet("g0"))).toBe("focused");
  });

  it("docks a minimized window's chip, and undocks it when restored, reopened or closed", () => {
    const ids = () => dockModule.getDock().map((e) => e.id);
    w.openGrampletWindow(gramplet("a"));
    w.setGrampletWindowMinimized("a", true);
    expect(w.getGrampletWindows()[0].minimized).toBe(true);
    expect(ids()).toEqual(["gramplet:a"]);
    w.setGrampletWindowMinimized("a", false);
    expect(ids()).toEqual([]);
    w.setGrampletWindowMinimized("a", true);
    w.openGrampletWindow(gramplet("a"));
    expect(w.getGrampletWindows()[0].minimized).toBe(false);
    expect(ids()).toEqual([]);
    w.setGrampletWindowMinimized("a", true);
    w.closeGrampletWindow("a");
    expect(ids()).toEqual([]);
    expect(w.getGrampletWindows()).toEqual([]);
  });

  it("restarts an open window with an edited Gramplet, or closes it if it became a View Gramplet", () => {
    w.openGrampletWindow(gramplet("a"));
    w.openGrampletWindow(gramplet("b"));
    w.setGrampletWindowMinimized("a", true);
    w.restartGrampletWindow(gramplet("a", { code: "v2" }));
    const a = w.getGrampletWindows().find((e) => e.gramplet.id === "a")!;
    expect(a).toMatchObject({ minimized: false, generation: 1 });
    expect(a.gramplet.code).toBe("v2");
    expect(dockModule.getDock()).toEqual([]);
    expect(w.getGrampletWindowZOrder()).toEqual(["b", "a"]);

    w.restartGrampletWindow(gramplet("a", { kind: undefined }));
    expect(w.getGrampletWindows().map((e) => e.gramplet.id)).toEqual(["b"]);

    w.restartGrampletWindow(gramplet("not-open"));
    expect(w.getGrampletWindows().map((e) => e.gramplet.id)).toEqual(["b"]);
  });

  it("brings a focused window to the front", () => {
    w.openGrampletWindow(gramplet("a"));
    w.openGrampletWindow(gramplet("b"));
    w.focusGrampletWindow("a");
    expect(w.getGrampletWindowZOrder()).toEqual(["b", "a"]);
  });

  it("tracks running windows, and forgets one on close", () => {
    w.openGrampletWindow(gramplet("a"));
    expect(w.isAnyGrampletRunning()).toBe(false);
    w.setGrampletRunning("a", true);
    expect(w.isAnyGrampletRunning()).toBe(true);
    w.closeGrampletWindow("a");
    expect(w.isAnyGrampletRunning()).toBe(false);
  });

  it("releases the least recently used idle worker beyond the limit", () => {
    const released: string[] = [];
    const idle = (id: string) => w.markWorkerIdle(id, () => released.push(id));
    idle("a");
    idle("b");
    expect(released).toEqual([]);
    idle("a"); // used again -- now the most recent
    idle("c");
    expect(released).toEqual(["b"]);
    w.forgetWorker("a"); // running again: no longer a candidate
    idle("d");
    expect(released).toEqual(["b"]);
    idle("e");
    expect(released).toEqual(["b", "c"]);
  });
});
