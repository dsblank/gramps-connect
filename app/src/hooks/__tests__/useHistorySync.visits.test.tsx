// @vitest-environment jsdom
// When useHistorySync records a visit for View > Visited: only a selection
// the user made (not a view's automatic first row), only for record types,
// and only once it has stayed selected for a second.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const snapshot = { selectedHandle: null as string | null, selectionIsDefault: false };
const fakeStore = {
  getSnapshot: () => snapshot,
  navigateToHandle: vi.fn(async () => {}),
  clearSelection: vi.fn(),
};
vi.mock("../../store/registry", () => ({ getViewStore: () => fakeStore }));
vi.mock("../useViewStore", () => ({ useViewStore: () => ({ ...snapshot }) }));
const recordVisit = vi.fn();
vi.mock("../../store/visitedHistory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../store/visitedHistory")>()),
  recordVisit: (...args: unknown[]) => recordVisit(...args),
}));

const { useHistorySync } = await import("../useHistorySync");

describe("useHistorySync visit recording", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recordVisit.mockReset();
    window.history.replaceState(null, "", "/#/person");
    snapshot.selectedHandle = null;
    snapshot.selectionIsDefault = false;
  });
  afterEach(() => vi.useRealTimers());

  function select(rerender: () => void, handle: string, isDefault = false) {
    snapshot.selectedHandle = handle;
    snapshot.selectionIsDefault = isDefault;
    act(() => rerender());
  }

  it("records a picked record after it stays selected for a second", () => {
    const { rerender } = renderHook(() => useHistorySync());
    select(rerender, "A");
    act(() => vi.advanceTimersByTime(900));
    expect(recordVisit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(recordVisit).toHaveBeenCalledWith("person", "A");
  });

  it("skips rows passed through quickly", () => {
    const { rerender } = renderHook(() => useHistorySync());
    select(rerender, "A");
    act(() => vi.advanceTimersByTime(300));
    select(rerender, "B");
    act(() => vi.advanceTimersByTime(300));
    select(rerender, "C");
    act(() => vi.advanceTimersByTime(1500));
    expect(recordVisit.mock.calls).toEqual([["person", "C"]]);
  });

  it("never records a view's automatic first-row selection", () => {
    const { rerender } = renderHook(() => useHistorySync());
    select(rerender, "A", true);
    act(() => vi.advanceTimersByTime(5000));
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("never records on a page that isn't a record list", () => {
    window.history.replaceState(null, "", "/#/story");
    const { rerender } = renderHook(() => useHistorySync());
    select(rerender, "S");
    act(() => vi.advanceTimersByTime(5000));
    expect(recordVisit).not.toHaveBeenCalled();
  });
});
