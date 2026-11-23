// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setNewsCheckEnabled } from "../../store/newsCheck";

vi.mock("../../auth/auth", () => ({
  getTreeId: vi.fn(() => "tree1"),
  getCurrentUsername: vi.fn(() => "owner"),
}));
vi.mock("../grampletMedia", () => ({
  canAuthorGramplets: vi.fn(() => true),
  fetchGramplets: vi.fn(),
}));
vi.mock("../grampletStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../grampletStore")>();
  return { ...actual, fetchCatalog: vi.fn() };
});

import { canAuthorGramplets, fetchGramplets } from "../grampletMedia";
import { fetchCatalog } from "../grampletStore";
import {
  acknowledgeGrampletStoreNews,
  acknowledgeNews,
  CHECK_INTERVAL_MS,
  computeNews,
  countNews,
  getGrampletStoreNews,
  startGrampletStoreCheck,
} from "../grampletStoreNews";
import type { CatalogEntry, Gramplet } from "../types";

function entry(id: string, version = "1.0.0"): CatalogEntry {
  return { id, name: id, description: "", version, author: "", category: "example", code: "" };
}

function installed(id: string, version: string): Gramplet {
  return { id: `local-${id}`, label: id, code: "", sourceId: id, sourceVersion: version } as Gramplet;
}

describe("computeNews", () => {
  it("first check records a baseline and reports no new Gramplets", () => {
    const state = computeNews([entry("a"), entry("b")], [], null, 100);
    expect(state.seenIds).toEqual(["a", "b"]);
    expect(state.pending).toEqual([]);
    expect(state.checkedAt).toBe(100);
  });

  it("first check still reports updates to installed Gramplets", () => {
    const state = computeNews([entry("a", "2.0.0")], [installed("a", "1.0.0")], null, 0);
    expect(state.pending).toEqual(["update:a@2.0.0"]);
  });

  it("reports ids not yet seen as new", () => {
    const prev = { checkedAt: 0, seenIds: ["a"], seenUpdates: [], pending: [] };
    expect(computeNews([entry("a"), entry("c")], [], prev, 1).pending).toEqual(["new:c"]);
  });

  it("doesn't re-report an update already seen, but does a newer one", () => {
    const prev = { checkedAt: 0, seenIds: ["a"], seenUpdates: ["a@2.0.0"], pending: [] };
    expect(computeNews([entry("a", "2.0.0")], [installed("a", "1.0.0")], prev, 1).pending).toEqual([]);
    expect(computeNews([entry("a", "3.0.0")], [installed("a", "1.0.0")], prev, 1).pending).toEqual([
      "update:a@3.0.0",
    ]);
  });
});

describe("acknowledgeNews / countNews", () => {
  it("marks every catalog id and current update as seen", () => {
    const state = acknowledgeNews([entry("a", "2.0.0"), entry("b")], [installed("a", "1.0.0")], 5);
    expect(state).toEqual({ checkedAt: 5, seenIds: ["a", "b"], seenUpdates: ["a@2.0.0"], pending: [] });
  });

  it("counts new and update keys separately", () => {
    expect(countNews(["new:a", "new:b", "update:c@2"])).toEqual({ newCount: 2, updateCount: 1 });
  });
});

describe("startGrampletStoreCheck", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.mocked(canAuthorGramplets).mockReturnValue(true);
    vi.mocked(fetchGramplets).mockResolvedValue([]);
    vi.mocked(fetchCatalog).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("baselines silently, then notifies about a Gramplet added a day later", async () => {
    const notify = vi.fn();
    vi.mocked(fetchCatalog).mockResolvedValue([entry("a")]);
    const stop = startGrampletStoreCheck(notify);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();

    // An hour later: not due yet, no request.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);

    vi.mocked(fetchCatalog).mockResolvedValue([entry("a"), entry("b")]);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith({ newCount: 1, updateCount: 0 });
    expect(getGrampletStoreNews()).toEqual({ newCount: 1, updateCount: 0 });

    // Opening the Store clears it.
    acknowledgeGrampletStoreNews([entry("a"), entry("b")], []);
    expect(getGrampletStoreNews()).toEqual({ newCount: 0, updateCount: 0 });
    stop();
  });

  it("does nothing for users who can't install Gramplets, or when switched off", async () => {
    vi.mocked(fetchCatalog).mockResolvedValue([entry("a")]);
    vi.mocked(canAuthorGramplets).mockReturnValue(false);
    const stop = startGrampletStoreCheck(vi.fn());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchCatalog).not.toHaveBeenCalled();

    vi.mocked(canAuthorGramplets).mockReturnValue(true);
    setNewsCheckEnabled(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fetchCatalog).not.toHaveBeenCalled();
    stop();
  });

  it("retries on the next hourly tick after a failed fetch", async () => {
    vi.mocked(fetchCatalog).mockRejectedValueOnce(new Error("offline")).mockResolvedValue([entry("a")]);
    const stop = startGrampletStoreCheck(vi.fn());
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    stop();
  });
});
