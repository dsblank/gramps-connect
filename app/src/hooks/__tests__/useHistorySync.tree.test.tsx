// @vitest-environment jsdom
// The tree prefix on routes (hash.ts): an older link with no tree gets this
// session's spelled in, and a link to another tree is held back and
// reported rather than applied.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRouteTreeSource } from "../../hash";

const snapshot = { selectedHandle: null as string | null, selectionIsDefault: false };
const fakeStore = {
  getSnapshot: () => snapshot,
  navigateToHandle: vi.fn(async (handle: string) => {
    snapshot.selectedHandle = handle;
  }),
  clearSelection: vi.fn(),
};
vi.mock("../../store/registry", () => ({ getViewStore: () => fakeStore }));
vi.mock("../useViewStore", () => ({ useViewStore: () => ({ ...snapshot }) }));

const { useHistorySync } = await import("../useHistorySync");

describe("useHistorySync tree prefix", () => {
  beforeEach(() => {
    setRouteTreeSource(() => "mine");
    snapshot.selectedHandle = null;
    snapshot.selectionIsDefault = false;
    fakeStore.navigateToHandle.mockClear();
  });
  afterEach(() => setRouteTreeSource(() => null));

  it("spells this tree into an older link, in place", async () => {
    window.history.replaceState(null, "", "/#/person/A");
    // Already selected (a reload): the mocked store can't re-render the hook
    // after an async navigateToHandle, the way the real one does.
    snapshot.selectedHandle = "A";
    const before = window.history.length;
    const { result } = renderHook(() => useHistorySync());
    await waitFor(() => expect(window.location.hash).toBe("#/t/mine/person/A"));
    expect(result.current.activeKey).toBe("person");
    expect(result.current.foreignTree).toBeNull();
    expect(window.history.length).toBe(before);
  });

  it("follows a link to this tree", async () => {
    window.history.replaceState(null, "", "/#/t/mine/person/A");
    const { result } = renderHook(() => useHistorySync());
    await waitFor(() => expect(fakeStore.navigateToHandle).toHaveBeenCalledWith("A"));
    expect(result.current.foreignTree).toBeNull();
  });

  it("holds back a link to another tree on load, landing on Home", async () => {
    window.history.replaceState(null, "", "/#/t/other/person/A");
    const { result } = renderHook(() => useHistorySync());
    expect(result.current.activeKey).toBe("home");
    expect(result.current.foreignTree).toEqual({ treeId: "other", hash: "#/t/other/person/A" });
    await waitFor(() => expect(window.location.hash).toBe("#/t/mine/home"));
    expect(fakeStore.navigateToHandle).not.toHaveBeenCalled();
    act(() => result.current.dismissForeignTree());
    expect(result.current.foreignTree).toBeNull();
  });

  it("holds back a link to another tree pasted mid-session, restoring the URL", async () => {
    window.history.replaceState(null, "", "/#/t/mine/person/A");
    const { result } = renderHook(() => useHistorySync());
    await waitFor(() => expect(fakeStore.navigateToHandle).toHaveBeenCalledWith("A"));
    fakeStore.navigateToHandle.mockClear();
    await act(async () => {
      window.location.hash = "#/t/other/family/F";
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.foreignTree).toEqual({ treeId: "other", hash: "#/t/other/family/F" });
    expect(result.current.activeKey).toBe("person");
    expect(window.location.hash).toBe("#/t/mine/person/A");
    expect(fakeStore.navigateToHandle).not.toHaveBeenCalled();
  });
});
