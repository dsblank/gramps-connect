import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  bumpTopicActivity as BumpTopicActivity,
  closeTopicWindow as CloseTopicWindow,
  getTopicActivityVersion as GetTopicActivityVersion,
  getTopicWindows as GetTopicWindows,
  openTopicWindow as OpenTopicWindow,
  subscribeTopicActivity as SubscribeTopicActivity,
  subscribeTopicWindows as SubscribeTopicWindows,
  toggleMinimizeTopicWindow as ToggleMinimizeTopicWindow,
} from "../topicWindows";

// topicWindows.ts's `windows`/`activityVersion` are module-level singleton
// state, same reasoning knownUsers.test.ts/activeUsers.test.ts already
// document -- fresh module instance per test via resetModules() + a
// dynamic re-import.
let openTopicWindow: typeof OpenTopicWindow;
let closeTopicWindow: typeof CloseTopicWindow;
let toggleMinimizeTopicWindow: typeof ToggleMinimizeTopicWindow;
let getTopicWindows: typeof GetTopicWindows;
let subscribeTopicWindows: typeof SubscribeTopicWindows;
let bumpTopicActivity: typeof BumpTopicActivity;
let subscribeTopicActivity: typeof SubscribeTopicActivity;
let getTopicActivityVersion: typeof GetTopicActivityVersion;

describe("topicWindows", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({
      openTopicWindow, closeTopicWindow, toggleMinimizeTopicWindow, getTopicWindows, subscribeTopicWindows,
      bumpTopicActivity, subscribeTopicActivity, getTopicActivityVersion,
    } = await import("../topicWindows"));
  });

  it("starts with no windows open", () => {
    expect(getTopicWindows()).toEqual([]);
  });

  it("opens a new window, expanded", () => {
    openTopicWindow("N1");
    expect(getTopicWindows()).toEqual([{ handle: "N1", minimized: false }]);
  });

  it("opening an already-open, already-expanded window is a no-op -- same array reference, no notification", () => {
    openTopicWindow("N1");
    const before = getTopicWindows();
    const listener = vi.fn();
    subscribeTopicWindows(listener);

    openTopicWindow("N1");

    expect(getTopicWindows()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  // This is the actual regression this suite exists to catch: useSyncExternalStore
  // decides whether to re-render by comparing what getSnapshot() returns via
  // Object.is across renders -- a change that mutates an existing element in
  // place without the array (or the element) itself becoming a new object is
  // invisible to it, even though the module's own state did change. Confirmed
  // live: a minimize/expand click did nothing until an unrelated re-render
  // (switching views) happened to re-read the by-then-mutated state fresh.
  describe("every state-changing call returns a fresh array reference from getTopicWindows()", () => {
    it("opening a new window", () => {
      const before = getTopicWindows();
      openTopicWindow("N1");
      expect(getTopicWindows()).not.toBe(before);
    });

    it("re-opening an already-open, minimized window", () => {
      openTopicWindow("N1");
      toggleMinimizeTopicWindow("N1");
      const before = getTopicWindows();

      openTopicWindow("N1");

      expect(getTopicWindows()).not.toBe(before);
      expect(getTopicWindows()).toEqual([{ handle: "N1", minimized: false }]);
    });

    it("toggling minimize", () => {
      openTopicWindow("N1");
      const before = getTopicWindows();

      toggleMinimizeTopicWindow("N1");

      expect(getTopicWindows()).not.toBe(before);
      expect(getTopicWindows()).toEqual([{ handle: "N1", minimized: true }]);
    });

    it("closing a window", () => {
      openTopicWindow("N1");
      const before = getTopicWindows();

      closeTopicWindow("N1");

      expect(getTopicWindows()).not.toBe(before);
      expect(getTopicWindows()).toEqual([]);
    });
  });

  it("toggling minimize on one window leaves every other window's own object reference untouched", () => {
    openTopicWindow("N1");
    openTopicWindow("N2");
    const [n1Before, n2Before] = getTopicWindows();

    toggleMinimizeTopicWindow("N2");

    const [n1After, n2After] = getTopicWindows();
    expect(n1After).toBe(n1Before);
    expect(n2After).not.toBe(n2Before);
    expect(n2After).toEqual({ handle: "N2", minimized: true });
  });

  it("closing a window that isn't open is a no-op -- no notification", () => {
    openTopicWindow("N1");
    const listener = vi.fn();
    subscribeTopicWindows(listener);

    closeTopicWindow("N-NOT-OPEN");

    expect(listener).not.toHaveBeenCalled();
  });

  it("toggling minimize on a window that isn't open is a no-op -- no notification", () => {
    const listener = vi.fn();
    subscribeTopicWindows(listener);

    toggleMinimizeTopicWindow("N-NOT-OPEN");

    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies every subscriber on each state-changing call, and stops once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTopicWindows(listener);

    openTopicWindow("N1");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    toggleMinimizeTopicWindow("N1");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("topic activity counter", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ bumpTopicActivity, subscribeTopicActivity, getTopicActivityVersion } = await import("../topicWindows"));
  });

  it("starts at 0 and increments on every bump, notifying subscribers", () => {
    expect(getTopicActivityVersion()).toBe(0);
    const listener = vi.fn();
    subscribeTopicActivity(listener);

    bumpTopicActivity();
    expect(getTopicActivityVersion()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    bumpTopicActivity();
    expect(getTopicActivityVersion()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
