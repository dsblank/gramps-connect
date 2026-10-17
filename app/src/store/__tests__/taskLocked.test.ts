import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apiFetch", () => ({ apiFetch: vi.fn() }));
vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("tok"),
  getCurrentUsername: vi.fn().mockReturnValue("alice"),
}));

import { apiFetch } from "../apiFetch";
import { parseErrorMessage } from "../api";

/** gramps-web-api v3.24.0's 409 for a tree-changing task while another runs. */
function lockedResponse(taskId: string | null = "t1"): Response {
  return new Response(JSON.stringify({
    error: {
      code: 409,
      message: "Another task is already running on this tree",
      type: "task_locked",
      ...(taskId ? { task: { href: `/api/tasks/${taskId}`, id: taskId } } : {}),
    },
  }), { status: 409 });
}

const task = (body: object) => new Response(JSON.stringify(body), { status: 200 });

describe("parseErrorMessage for task_locked", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("names the blocking task and who started it", async () => {
    vi.mocked(apiFetch).mockResolvedValue(task({ name: "import_file", user_name: "bob", created_at: "2026-10-17T10:05:00Z" }));
    const message = await parseErrorMessage(lockedResponse());
    expect(message).toMatch(/^An import \(started by bob at .+\) is still running on this tree\. Try again once it has finished\.$/);
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toMatch(/\/api\/tasks\/t1$/);
  });

  it("leaves out the user when it's the current one", async () => {
    vi.mocked(apiFetch).mockResolvedValue(task({ name: "check_repair_database", user_name: "alice" }));
    expect(await parseErrorMessage(lockedResponse())).toBe(
      "Check and Repair is still running on this tree. Try again once it has finished.",
    );
  });

  it("falls back to the server's message when the task can't be looked up", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response("", { status: 403 }));
    expect(await parseErrorMessage(lockedResponse())).toBe(
      "Another task is already running on this tree. Try again once it has finished.",
    );
  });

  it("doesn't look anything up without a task id", async () => {
    expect(await parseErrorMessage(lockedResponse(null))).toBe(
      "Another task is already running on this tree. Try again once it has finished.",
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("leaves other errors alone", async () => {
    const res = new Response(JSON.stringify({ error: { code: 409, message: "Merge conflict" } }), { status: 409 });
    expect(await parseErrorMessage(res)).toBe("Merge conflict");
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
