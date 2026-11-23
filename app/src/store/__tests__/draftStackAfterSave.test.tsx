// @vitest-environment jsdom
// A record created from a Related Pane "+" is linked to the record it was
// created from only once it's saved (DraftEntry.afterSave).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const showNotification = vi.fn();
vi.mock("@mantine/notifications", () => ({ notifications: { show: showNotification } }));
vi.mock("../nameGroups", () => ({ setNameGroup: vi.fn(async () => {}) }));
vi.mock("../registry", () => ({ getViewStore: () => ({ requeryDebounced: () => {} }) }));
vi.mock("../../auth/auth", () => ({ getToken: async () => "token" }));
vi.mock("../objectsApi", () => ({
  createHandle: () => "new1",
  createObjects: vi.fn(async () => { calls.push("create"); }),
  updateObject: vi.fn(async () => {}),
  fetchPlainObject: vi.fn(async () => ({})),
}));

// A tag draft goes through saveTagDraft (store/tagOrder.ts) first; by
// default it hands the data back for the ordinary create.
const saveTagDraft = vi.fn(async (_token: string, draft: { data: Record<string, unknown> }) => draft.data as Record<string, unknown> | null);
vi.mock("../tagOrder", () => ({ saveTagDraft, withoutMoveMarker: (d: Record<string, unknown>) => d }));

const { useDraftStack } = await import("../draftStack");

describe("afterSave on a new draft", () => {
  beforeEach(() => {
    calls.length = 0;
    showNotification.mockClear();
  });

  it("runs with the new handle after the object is created, and starts from the given data", async () => {
    const { result } = renderHook(() => useDraftStack());
    const run = vi.fn(async (handle: string) => { calls.push(`link ${handle}`); });
    act(() => {
      result.current.openDraft("tag", undefined, { data: { name: "Brick" }, afterSave: { run, failureText: "add it here" } });
    });
    expect(result.current.stack[0].data).toMatchObject({ _class: "Tag", handle: "new1", name: "Brick" });
    let saved: unknown[] = [];
    await act(async () => {
      saved = await result.current.saveAll();
    });
    expect(calls).toEqual(["create", "link new1"]);
    expect(saved).toHaveLength(1);
  });

  it("skips the ordinary create for a tag saved as a reorder transaction, and still links it", async () => {
    saveTagDraft.mockImplementationOnce(async () => {
      calls.push("reorder");
      return null;
    });
    const { result } = renderHook(() => useDraftStack());
    const run = vi.fn(async (handle: string) => { calls.push(`link ${handle}`); });
    act(() => {
      result.current.openDraft("tag", undefined, { data: { name: "Brick" }, afterSave: { run, failureText: "add it here" } });
    });
    let saved: unknown[] = [];
    await act(async () => {
      saved = await result.current.saveAll();
    });
    expect(calls).toEqual(["reorder", "link new1"]);
    expect(saved).toHaveLength(1);
  });

  it("doesn't run for a cancelled draft", async () => {
    const { result } = renderHook(() => useDraftStack());
    const run = vi.fn(async () => {});
    act(() => {
      result.current.openDraft("note", undefined, { afterSave: { run, failureText: "add it here" } });
    });
    act(() => result.current.closeDraft("new1"));
    await act(async () => {
      await result.current.saveAll();
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a failed link without failing the save", async () => {
    const { result } = renderHook(() => useDraftStack());
    const run = vi.fn(async () => { throw new Error("boom"); });
    act(() => {
      result.current.openDraft("note", undefined, { afterSave: { run, failureText: "add it to this person" } });
    });
    let saved: unknown[] = [];
    await act(async () => {
      saved = await result.current.saveAll();
    });
    expect(saved).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Saved the new note, but couldn't add it to this person",
      message: "boom",
    }));
  });
});
