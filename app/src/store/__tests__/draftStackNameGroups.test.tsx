// @vitest-environment jsdom
// Tree-wide surname groupings from the name editor wait on the draft until
// the person saves, so cancelling the edit discards them.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setNameGroup = vi.fn(async () => {});
vi.mock("../nameGroups", () => ({ setNameGroup }));
vi.mock("../registry", () => ({ getViewStore: () => ({ requeryDebounced: () => {} }) }));
vi.mock("../../auth/auth", () => ({ getToken: async () => "token" }));
const person = { _class: "Person", handle: "p1", primary_name: { surname_list: [{ surname: "Smyth", primary: true }] } };
vi.mock("../objectsApi", () => ({
  createHandle: () => "new1",
  createObjects: vi.fn(async () => {}),
  updateObject: vi.fn(async () => {}),
  fetchPlainObject: vi.fn(async () => person),
}));

const { useDraftStack } = await import("../draftStack");

async function editPerson() {
  const hook = renderHook(() => useDraftStack());
  act(() => hook.result.current.openEditDraft("person", "p1"));
  await waitFor(() => expect(hook.result.current.stack[0]?.status).toBe("ready"));
  return hook;
}

describe("pending surname groupings on a draft", () => {
  beforeEach(() => setNameGroup.mockClear());

  it("are written only after the person saves", async () => {
    const { result } = await editPerson();
    act(() => result.current.setPendingNameGroup("p1", "Smyth", "Smith"));
    expect(setNameGroup).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.saveAll();
    });
    expect(setNameGroup).toHaveBeenCalledWith("Smyth", "Smith");
  });

  it("are dropped by Cancel, and don't come back when the person is edited again", async () => {
    const { result } = await editPerson();
    act(() => result.current.setPendingNameGroup("p1", "Smyth", "Smith"));
    act(() => result.current.closeDraft("p1"));
    act(() => result.current.openEditDraft("person", "p1"));
    await waitFor(() => expect(result.current.stack[0]?.status).toBe("ready"));
    expect(result.current.stack[0].nameGroups).toBeUndefined();
    await act(async () => {
      await result.current.saveAll();
    });
    expect(setNameGroup).not.toHaveBeenCalled();
  });

  it("can be forgotten before saving, or ask to ungroup", async () => {
    const { result } = await editPerson();
    act(() => result.current.setPendingNameGroup("p1", "Smyth", "Smith"));
    act(() => result.current.setPendingNameGroup("p1", "Smyth", undefined));
    act(() => result.current.setPendingNameGroup("p1", "Jonas", null));
    await act(async () => {
      await result.current.saveAll();
    });
    expect(setNameGroup.mock.calls).toEqual([["Jonas", null]]);
  });
});
