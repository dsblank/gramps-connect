import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getCurrentUsername: vi.fn(),
  // AddObject: may this user save a job's file into the tree as Media?
  hasPermissions: vi.fn(() => true),
}));
vi.mock("../jobsApi", () => ({
  getTaskStatus: vi.fn(),
  listOwnTasks: vi.fn(),
}));
vi.mock("../jobsPromote", async (importOriginal) => ({
  jobResultMessages: (await importOriginal<typeof import("../jobsPromote")>()).jobResultMessages,
  promoteJob: vi.fn(),
  downloadArchiveLocally: vi.fn(),
  describeGenericJob: vi.fn().mockResolvedValue("desc"),
  MEDIA_ARCHIVE_URL_RE: /^\/api\/media\/archive\//,
}));

import { getCurrentUsername, hasPermissions } from "../../auth/auth";
import { getTaskStatus, listOwnTasks, type TaskListItem, type TaskStatus } from "../jobsApi";
import { promoteJob, downloadArchiveLocally } from "../jobsPromote";
import { deliverJob, sweepOnce, trackJob } from "../jobsPoll";

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
    vi.mocked(promoteJob).mockReset().mockResolvedValue({ handle: "h1", desc: "d", hasReport: false });
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

  it("passes an export's report messages through to promoteJob", async () => {
    vi.mocked(listOwnTasks).mockResolvedValue([task({ task_id: "mine", name: "export_db" })]);
    vi.mocked(getTaskStatus).mockResolvedValue({
      state: "SUCCESS",
      result_object: { url: "/api/exporters/ged/file/processed/y.ged", messages: ["Dropped attribute X", " "] },
    } as TaskStatus);

    await sweepOnce({ onPromoted: vi.fn(), onDownloaded: vi.fn(), onFailed: vi.fn() });

    expect(promoteJob).toHaveBeenCalledWith(
      "test-token", "export", "/api/exporters/ged/file/processed/y.ged", "desc", ["Dropped attribute X"]
    );
  });

  it("passes no messages for a result without any (reports, older servers)", async () => {
    vi.mocked(listOwnTasks).mockResolvedValue([task({ task_id: "mine" })]);
    vi.mocked(getTaskStatus).mockResolvedValue(successStatus("/api/reports/x/file/processed/y.pdf"));

    await sweepOnce({ onPromoted: vi.fn(), onDownloaded: vi.fn(), onFailed: vi.fn() });

    expect(promoteJob).toHaveBeenCalledWith("test-token", "report", "/api/reports/x/file/processed/y.pdf", "desc", []);
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
    expect(onDownloaded).toHaveBeenCalledWith("desc", "export", []);
    expect(onPromoted).not.toHaveBeenCalled();
  });
});

describe("trackJob", () => {
  beforeEach(() => {
    vi.mocked(getTaskStatus).mockReset();
    vi.mocked(promoteJob).mockReset().mockResolvedValue({ handle: "h1", desc: "d", hasReport: false });
  });

  // A running export that has reported progress ("Exporting...") is in
  // PROGRESS -- it must keep being polled, not be reported as failed.
  it("keeps polling through PROGRESS and promotes on SUCCESS", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getTaskStatus)
        .mockResolvedValueOnce({ state: "PROGRESS", result_object: { progress: 0.5 } })
        .mockResolvedValueOnce(successStatus("/api/exporters/gramps/file/processed/x.gramps"));
      const callbacks = { onPromoted: vi.fn(), onDownloaded: vi.fn(), onFailed: vi.fn() };

      trackJob("t1", "export", callbacks, "desc");
      await vi.runAllTimersAsync();

      expect(getTaskStatus).toHaveBeenCalledTimes(2);
      expect(callbacks.onFailed).not.toHaveBeenCalled();
      expect(callbacks.onPromoted).toHaveBeenCalledWith({ handle: "h1", desc: "d", hasReport: false }, "export");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deliverJob", () => {
  const callbacks = () => ({ onPromoted: vi.fn(), onDownloaded: vi.fn() });

  beforeEach(() => {
    vi.mocked(hasPermissions).mockReset().mockReturnValue(true);
    vi.mocked(promoteJob).mockReset().mockResolvedValue({ handle: "h1", desc: "d", hasReport: false });
    vi.mocked(downloadArchiveLocally).mockReset().mockResolvedValue(true);
  });

  it("saves a report into the tree for a user who can add records", async () => {
    const cb = callbacks();
    await deliverJob("tok", "report", "/api/reports/x/file/processed/y.pdf", "desc", [], cb);
    expect(hasPermissions).toHaveBeenCalledWith("AddObject");
    expect(promoteJob).toHaveBeenCalledTimes(1);
    expect(downloadArchiveLocally).not.toHaveBeenCalled();
    expect(cb.onPromoted).toHaveBeenCalledTimes(1);
  });

  it("downloads a report instead for a user who can't add records (Guest, Member)", async () => {
    vi.mocked(hasPermissions).mockReturnValue(false);
    const cb = callbacks();
    await deliverJob("tok", "report", "/api/reports/x/file/processed/y.pdf", "desc", [], cb);
    expect(promoteJob).not.toHaveBeenCalled();
    expect(downloadArchiveLocally).toHaveBeenCalledWith("tok", "/api/reports/x/file/processed/y.pdf", "desc");
    expect(cb.onDownloaded).toHaveBeenCalledWith("desc", "report", []);
  });

  it("downloads an export too, passing along what it left out", async () => {
    vi.mocked(hasPermissions).mockReturnValue(false);
    const cb = callbacks();
    await deliverJob("tok", "export", "/api/exporters/gramps/file/processed/y.gramps", "desc", ["3 notes skipped"], cb);
    expect(cb.onDownloaded).toHaveBeenCalledWith("desc", "export", ["3 notes skipped"]);
  });

  it("always downloads a media archive, whoever asks", async () => {
    const cb = callbacks();
    await deliverJob("tok", "export", "/api/media/archive/y.zip", "desc", [], cb);
    expect(promoteJob).not.toHaveBeenCalled();
    expect(cb.onDownloaded).toHaveBeenCalledTimes(1);
  });

  it("announces nothing when the file was already claimed elsewhere", async () => {
    vi.mocked(hasPermissions).mockReturnValue(false);
    vi.mocked(downloadArchiveLocally).mockResolvedValue(false);
    const cb = callbacks();
    await deliverJob("tok", "report", "/api/reports/x/file/processed/y.pdf", "desc", [], cb);
    expect(cb.onDownloaded).not.toHaveBeenCalled();
  });
});
