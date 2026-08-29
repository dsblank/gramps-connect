import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getCurrentUsername: vi.fn(),
}));
vi.mock("../jobsApi", () => ({
  getTaskStatus: vi.fn(),
  listOwnTasks: vi.fn(),
}));
vi.mock("../jobsPromote", () => ({
  promoteJob: vi.fn(),
  downloadArchiveLocally: vi.fn(),
  describeGenericJob: vi.fn().mockResolvedValue("desc"),
  MEDIA_ARCHIVE_URL_RE: /^\/api\/media\/archive\//,
}));

import { getCurrentUsername } from "../../auth/auth";
import { getTaskStatus, listOwnTasks, type TaskListItem, type TaskStatus } from "../jobsApi";
import { promoteJob, downloadArchiveLocally } from "../jobsPromote";
import { sweepOnce } from "../jobsPoll";

function task(overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    task_id: "t1",
    name: "generate_report",
    created_at: "2026-01-01T00:00:00Z",
    user_name: "alice",
    state: "SUCCESS",
    ...overrides,
  };
}

function successStatus(url: string): TaskStatus {
  return { state: "SUCCESS", result_object: { url } };
}

describe("sweepOnce", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUsername).mockReturnValue("alice");
    vi.mocked(getTaskStatus).mockReset();
    vi.mocked(listOwnTasks).mockReset();
    vi.mocked(promoteJob).mockReset().mockResolvedValue({ handle: "h1", desc: "d" });
    vi.mocked(downloadArchiveLocally).mockReset().mockResolvedValue(true);
  });

  it("promotes a task dispatched by the current user", async () => {
    vi.mocked(listOwnTasks).mockResolvedValue([task({ task_id: "mine", user_name: "alice" })]);
    vi.mocked(getTaskStatus).mockResolvedValue(successStatus("/api/reports/x/file/processed/y.pdf"));

    const onPromoted = vi.fn();
    await sweepOnce({ onPromoted, onDownloaded: vi.fn(), onFailed: vi.fn() });

    expect(getTaskStatus).toHaveBeenCalledWith("test-token", "mine");
    expect(onPromoted).toHaveBeenCalledTimes(1);
  });

  // F5: TaskListResource only scopes to the caller server-side for a user
  // *without* PERM_VIEW_OTHER_USER -- Owner and above get every user's
  // tasks back from listOwnTasks(). Without this filter, an Owner's sweep
  // would claim (delete-on-read) another member's just-generated report.
  it("skips a task dispatched by a different user, even if the server returned it", async () => {
    vi.mocked(listOwnTasks).mockResolvedValue([task({ task_id: "theirs", user_name: "bob" })]);

    const onPromoted = vi.fn();
    await sweepOnce({ onPromoted, onDownloaded: vi.fn(), onFailed: vi.fn() });

    expect(getTaskStatus).not.toHaveBeenCalled();
    expect(promoteJob).not.toHaveBeenCalled();
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it("still sweeps this user's own tasks from a different browser/device (no user_name isn't a match)", async () => {
    vi.mocked(listOwnTasks).mockResolvedValue([
      task({ task_id: "mine", user_name: "alice" }),
      task({ task_id: "theirs", user_name: "bob" }),
      task({ task_id: "unattributed", user_name: undefined }),
    ]);
    vi.mocked(getTaskStatus).mockResolvedValue(successStatus("/api/reports/x/file/processed/y.pdf"));

    await sweepOnce({ onPromoted: vi.fn(), onDownloaded: vi.fn(), onFailed: vi.fn() });

    expect(getTaskStatus).toHaveBeenCalledTimes(1);
    expect(getTaskStatus).toHaveBeenCalledWith("test-token", "mine");
  });

  // F4: a media archive is never promoted into the tree as Media -- it goes
  // straight to the user's disk (jobsPromote.ts's downloadArchiveLocally).
  it("downloads a media archive locally instead of promoting it", async () => {
    vi.mocked(listOwnTasks).mockResolvedValue([task({ task_id: "archive", name: "export_media" })]);
    vi.mocked(getTaskStatus).mockResolvedValue(successStatus("/api/media/archive/abc.zip"));

    const onPromoted = vi.fn();
    const onDownloaded = vi.fn();
    await sweepOnce({ onPromoted, onDownloaded, onFailed: vi.fn() });

    expect(promoteJob).not.toHaveBeenCalled();
    expect(downloadArchiveLocally).toHaveBeenCalledWith("test-token", "/api/media/archive/abc.zip", "desc");
    expect(onDownloaded).toHaveBeenCalledWith("desc", "export");
    expect(onPromoted).not.toHaveBeenCalled();
  });
});
