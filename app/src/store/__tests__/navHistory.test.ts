// @vitest-environment jsdom
// Drives jsdom's real history (hash assignments, history.back/forward and
// the hashchange events they fire) rather than a fake, since the whole
// point of navHistory.ts is how it reads those.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type NavModule = typeof import("../navHistory");

/** jsdom fires hashchange (and runs traversals) asynchronously. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

async function navigate(hash: string): Promise<void> {
  window.location.hash = hash;
  await settle();
}

async function back(nav: NavModule): Promise<void> {
  nav.goBack();
  await settle();
}

async function forward(nav: NavModule): Promise<void> {
  nav.goForward();
  await settle();
}

describe("navHistory", () => {
  let nav: NavModule;
  let stop: () => void;

  beforeEach(async () => {
    sessionStorage.clear();
    // A fresh, unstamped entry each test, like a new page load.
    window.history.replaceState(null, "", "/#/home");
    vi.resetModules();
    nav = await import("../navHistory");
    stop = nav.installNavHistory();
  });

  afterEach(() => stop());

  it("starts with nowhere to go", () => {
    expect(nav.getNavHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: false });
  });

  it("enables Back after a navigation, and Forward after going back", async () => {
    await navigate("#/people/A");
    expect(nav.getNavHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });

    await back(nav);
    expect(window.location.hash).toBe("#/home");
    expect(nav.getNavHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: true });

    await forward(nav);
    expect(window.location.hash).toBe("#/people/A");
    expect(nav.getNavHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });
  });

  it("drops Forward when a new page is visited after going back", async () => {
    await navigate("#/people/A");
    await navigate("#/people/B");
    await back(nav);
    expect(nav.getNavHistorySnapshot().canGoForward).toBe(true);

    await navigate("#/places/C");
    expect(nav.getNavHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });
    await back(nav);
    expect(window.location.hash).toBe("#/people/A");
  });

  it("does nothing on Back at the first page", async () => {
    const spy = vi.spyOn(window.history, "back");
    nav.goBack();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("keeps its place across a reload", async () => {
    await navigate("#/people/A");
    await navigate("#/people/B");
    await back(nav);
    // A reload: the entry keeps its stamp, the module starts over.
    stop();
    vi.resetModules();
    nav = await import("../navHistory");
    stop = nav.installNavHistory();
    expect(nav.getNavHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: true });
  });

  it("notifies subscribers only when something changes", async () => {
    const listener = vi.fn();
    const unsubscribe = nav.subscribeNavHistory(listener);
    await navigate("#/people/A");
    expect(listener).toHaveBeenCalledTimes(1);
    await navigate("#/people/B");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
