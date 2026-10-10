import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BottomDock from "../bottomDock";

let dockModule: typeof BottomDock;

describe("bottomDock", () => {
  beforeEach(async () => {
    vi.resetModules();
    dockModule = await import("../bottomDock");
  });

  it("puts the newest card at the corner and older ones further left", () => {
    const { dock, getDock, dockOffsets, DOCK_MARGIN, DOCK_GAP } = dockModule;
    dock("topic:N1", 320);
    dock("gramplet:g1", 240);
    const offsets = dockOffsets(getDock());
    expect(offsets.get("gramplet:g1")).toBe(DOCK_MARGIN);
    expect(offsets.get("topic:N1")).toBe(DOCK_MARGIN + 240 + DOCK_GAP);
  });

  it("closes the gap when a card is undocked", () => {
    const { dock, undock, getDock, dockOffsets, DOCK_MARGIN } = dockModule;
    dock("a", 100);
    dock("b", 100);
    undock("b");
    expect(dockOffsets(getDock()).get("a")).toBe(DOCK_MARGIN);
  });

  it("keeps an already-docked card's place, and treats a no-op as no change", () => {
    const { dock, undock, getDock, subscribeDock } = dockModule;
    dock("a", 100);
    dock("b", 100);
    const listener = vi.fn();
    subscribeDock(listener);
    const before = getDock();
    dock("a", 100);
    undock("missing");
    expect(getDock()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(getDock().map((e) => e.id)).toEqual(["a", "b"]);
  });
});
