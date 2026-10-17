// @vitest-environment jsdom
// jsdom for sessionStorage. Uses Mantine's real notifications store (not a
// mock), so show/hide/update ordering is checked as it actually behaves.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanNotifications, notificationsStore } from "@mantine/notifications";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("../jobsApi", () => ({ getTaskStatus: vi.fn() }));

import { getTaskStatus } from "../jobsApi";
import { indexTaskIds, rememberIndexTasks, watchRememberedIndexTasks } from "../searchIndexWatch";

const shown = () => notificationsStore.getState().notifications;

describe("indexTaskIds", () => {
  it("reads the ids out of an import result's index_tasks", () => {
    expect(indexTaskIds({ people: 3, index_tasks: [{ id: "a", href: "/api/tasks/a" }, { id: "b" }] })).toEqual(["a", "b"]);
  });

  it("is empty for a result without any (older servers, no task queue)", () => {
    expect(indexTaskIds({ people: 3, messages: [] })).toEqual([]);
    expect(indexTaskIds(null)).toEqual([]);
  });
});

describe("watchRememberedIndexTasks", () => {
  beforeEach(() => {
    sessionStorage.clear();
    cleanNotifications();
    vi.mocked(getTaskStatus).mockReset();
  });

  it("does nothing when no import left a reindex running", () => {
    watchRememberedIndexTasks()();
    expect(shown()).toEqual([]);
    expect(getTaskStatus).not.toHaveBeenCalled();
  });

  it("survives StrictMode's mount-unmount-mount and reports success", async () => {
    rememberIndexTasks({ index_tasks: [{ id: "t1" }] });
    let finish!: () => void;
    vi.mocked(getTaskStatus).mockImplementation(
      () => new Promise((resolve) => { finish = () => resolve({ state: "SUCCESS", result_object: null }); }),
    );

    watchRememberedIndexTasks()(); // first mount, then its cleanup
    const cleanup = watchRememberedIndexTasks(); // the real mount
    await vi.waitFor(() => expect(getTaskStatus).toHaveBeenCalledTimes(2));
    expect(shown()).toEqual([expect.objectContaining({ id: "search-index-updating", loading: true })]);

    finish();
    await vi.waitFor(() =>
      expect(shown()).toEqual([expect.objectContaining({ id: "search-index-updating", loading: false, color: "green" })]),
    );
    // Finished: nothing left for the next page load to pick up.
    expect(sessionStorage.length).toBe(0);
    cleanup();
  });

  it("says so when a reindex failed", async () => {
    rememberIndexTasks({ index_tasks: [{ id: "t1" }, { id: "t2" }] });
    vi.mocked(getTaskStatus)
      .mockResolvedValueOnce({ state: "SUCCESS", result_object: null })
      .mockResolvedValueOnce({ state: "FAILURE", result_object: null });
    watchRememberedIndexTasks();
    await vi.waitFor(() =>
      expect(shown()).toEqual([expect.objectContaining({ color: "red", title: "Search index update failed" })]),
    );
  });
});
