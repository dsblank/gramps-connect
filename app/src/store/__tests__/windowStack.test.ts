import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as GrampletWindows from "../grampletWindows";
import type * as ExternalSearchWindow from "../externalSearchWindow";
import type * as WindowStack from "../windowStack";
import type { ObjectDetail } from "../objectDetail";

let g: typeof GrampletWindows;
let x: typeof ExternalSearchWindow;
let s: typeof WindowStack;

describe("windowStack (shared by Gramplet and External Search windows)", () => {
  beforeEach(async () => {
    vi.resetModules();
    g = await import("../grampletWindows");
    x = await import("../externalSearchWindow");
    s = await import("../windowStack");
  });

  it("stacks both kinds in one order, so focusing either brings it above the other", () => {
    g.openGrampletWindow({ id: "a", label: "a", code: "", kind: "window" });
    x.openExternalSearchWindow({ handle: "P1" } as ObjectDetail);
    expect(s.getWindowStack()).toEqual(["gramplet:a", "external-search"]);

    // Already the top Gramplet, but still under External Search.
    g.focusGrampletWindow("a");
    expect(s.getWindowStack()).toEqual(["external-search", "gramplet:a"]);

    x.raiseExternalSearchWindow();
    expect(s.getWindowStack()).toEqual(["gramplet:a", "external-search"]);

    x.closeExternalSearchWindow();
    g.closeGrampletWindow("a");
    expect(s.getWindowStack()).toEqual([]);
  });
});
