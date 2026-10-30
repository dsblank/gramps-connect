import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("../cacheMeta", () => ({ fetchServerState: vi.fn() }));
vi.mock("../mergeApi", () => ({
  deleteObjectsBulk: vi.fn(),
  deleteObjectsBulkBackground: vi.fn(),
}));
vi.mock("../placeReconnect", () => ({ reconnectPlaceChildren: vi.fn() }));
vi.mock("../taskApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../taskApi")>()),
  waitForTask: vi.fn(),
}));

import { fetchServerState } from "../cacheMeta";
import { deleteObjectsBulk, deleteObjectsBulkBackground } from "../mergeApi";
import { reconnectPlaceChildren } from "../placeReconnect";
import { waitForTask } from "../taskApi";
import { BULK_DELETE_THRESHOLD, PartialDeleteError, deleteSelected, type BulkDeleteProgress } from "../bulkDelete";
import { VIEWS } from "../views";

const PERSON_VIEW = VIEWS.find((v) => v.key === "person")!;
const PLACE_VIEW = VIEWS.find((v) => v.key === "place")!;

function handles(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `H${i}`);
}

function serverVersion(webApiVersion: string) {
  vi.mocked(fetchServerState).mockResolvedValue({ webApiVersion } as Awaited<ReturnType<typeof fetchServerState>>);
}

beforeEach(() => {
  vi.mocked(deleteObjectsBulk).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteObjectsBulkBackground).mockReset();
  vi.mocked(reconnectPlaceChildren).mockReset().mockResolvedValue(undefined);
  vi.mocked(waitForTask).mockReset();
  vi.mocked(fetchServerState).mockReset();
});

describe("deleteSelected", () => {
  it("sends one synchronous request up to the threshold, on any server", async () => {
    serverVersion("3.25.0");
    await deleteSelected(PERSON_VIEW, handles(BULK_DELETE_THRESHOLD));
    expect(deleteObjectsBulk).toHaveBeenCalledTimes(1);
    expect(deleteObjectsBulkBackground).not.toHaveBeenCalled();
  });

  it("uses one background task past the threshold on v3.25.0+, reporting the task's progress", async () => {
    serverVersion("3.25.0");
    vi.mocked(deleteObjectsBulkBackground).mockResolvedValue({ kind: "task", task: { id: "T1" } });
    vi.mocked(waitForTask).mockImplementation(async (_id, onStatus) => {
      onStatus?.({ state: "PROGRESS", result_object: { current: 300, total: 1200 } });
      return { state: "SUCCESS", result_object: null };
    });
    const progress: BulkDeleteProgress[] = [];

    await deleteSelected(PERSON_VIEW, handles(1200), (p) => progress.push(p));

    expect(deleteObjectsBulkBackground).toHaveBeenCalledWith("test-token", PERSON_VIEW, handles(1200));
    expect(deleteObjectsBulk).not.toHaveBeenCalled();
    expect(progress[progress.length - 1]).toEqual({ phase: "deleting", done: 300, total: 1200 });
  });

  it("accepts a server without a task queue finishing inline (200)", async () => {
    serverVersion("3.25.0");
    vi.mocked(deleteObjectsBulkBackground).mockResolvedValue({ kind: "done", result: [] });
    await deleteSelected(PERSON_VIEW, handles(1200));
    expect(waitForTask).not.toHaveBeenCalled();
  });

  it("throws the task's own error when the background delete fails", async () => {
    serverVersion("3.25.0");
    vi.mocked(deleteObjectsBulkBackground).mockResolvedValue({ kind: "task", task: { id: "T1" } });
    vi.mocked(waitForTask).mockResolvedValue({ state: "FAILURE", result_object: { error: "boom" } });
    await expect(deleteSelected(PERSON_VIEW, handles(1200))).rejects.toThrow("boom");
  });

  it("sends chunks of the threshold size past it on an older server", async () => {
    serverVersion("3.24.0");
    const progress: BulkDeleteProgress[] = [];

    await deleteSelected(PERSON_VIEW, handles(1200), (p) => progress.push(p));

    expect(deleteObjectsBulkBackground).not.toHaveBeenCalled();
    const sizes = vi.mocked(deleteObjectsBulk).mock.calls.map((call) => call[2].length);
    expect(sizes).toEqual([500, 500, 200]);
    expect(progress[progress.length - 1]).toEqual({ phase: "deleting", done: 1200, total: 1200 });
  });

  it("falls back to chunks when the server version can't be read", async () => {
    vi.mocked(fetchServerState).mockRejectedValue(new Error("offline"));
    await deleteSelected(PERSON_VIEW, handles(600));
    expect(deleteObjectsBulk).toHaveBeenCalledTimes(2);
  });

  it("reports how many were deleted when a later chunk fails", async () => {
    serverVersion("3.24.0");
    vi.mocked(deleteObjectsBulk)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Server error"));

    const err = await deleteSelected(PERSON_VIEW, handles(1200)).catch((e) => e);

    expect(err).toBeInstanceOf(PartialDeleteError);
    expect(err.deleted).toBe(500);
  });

  it("throws the plain error when the first chunk fails (nothing deleted)", async () => {
    serverVersion("3.24.0");
    vi.mocked(deleteObjectsBulk).mockRejectedValueOnce(new Error("Server error"));
    const err = await deleteSelected(PERSON_VIEW, handles(1200)).catch((e) => e);
    expect(err).not.toBeInstanceOf(PartialDeleteError);
  });

  it("reattaches enclosed places before deleting places, with every handle at once", async () => {
    serverVersion("3.25.0");
    await deleteSelected(PLACE_VIEW, handles(3));
    expect(reconnectPlaceChildren).toHaveBeenCalledWith("test-token", handles(3));
    expect(vi.mocked(reconnectPlaceChildren).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deleteObjectsBulk).mock.invocationCallOrder[0]);
  });
});
