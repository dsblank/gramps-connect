import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../apiFetch", () => ({ apiFetch }));
vi.mock("../taskApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../taskApi")>()),
  waitForTask: vi.fn(),
}));

import { waitForTask } from "../taskApi";
import { BULK_EDIT_BACKGROUND_FROM, editSelected, supportsBulkEdit, type BulkEditProgress } from "../bulkEdit";
import { VIEWS } from "../views";

const PERSON_VIEW = VIEWS.find((v) => v.key === "person")!;
const TAG_VIEW = VIEWS.find((v) => v.key === "tag")!;
const handles = (n: number) => Array.from({ length: n }, (_, i) => `H${i}`);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  apiFetch.mockReset();
  vi.mocked(waitForTask).mockReset();
});

describe("editSelected", () => {
  it("sends one request with the type's namespace and the operations, and counts what changed", async () => {
    apiFetch.mockResolvedValue(json([{ handle: "H0" }, { handle: "H2" }]));
    const changed = await editSelected(PERSON_VIEW, handles(3), [{ op: "add_tag", handle: "T1" }]);
    expect(changed).toBe(2);
    const [url, init, options] = apiFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/objects\/edit-by-handle\/$/);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      namespace: "people",
      handles: ["H0", "H1", "H2"],
      operations: [{ op: "add_tag", handle: "T1" }],
    });
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(options).toBeUndefined();
  });

  it("runs a large edit as a background task, with its progress", async () => {
    apiFetch.mockResolvedValue(json({ task: { id: "t1" } }, 202));
    vi.mocked(waitForTask).mockImplementation(async (_id, onStatus) => {
      onStatus?.({ state: "PROGRESS", result_object: { current: 300, total: 600 } } as never);
      return { state: "SUCCESS", result_object: handles(450).map((handle) => ({ handle })) } as never;
    });
    const seen: BulkEditProgress[] = [];
    const total = BULK_EDIT_BACKGROUND_FROM + 100;
    const changed = await editSelected(PERSON_VIEW, handles(total), [{ op: "set_private", value: true }], (p) => seen.push(p));
    const [url, , options] = apiFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/objects\/edit-by-handle\/\?background=true$/);
    expect(options).toEqual({ lane: "long" });
    expect(seen).toEqual([{ done: null, total }, { done: 300, total }]);
    expect(changed).toBe(450);
  });

  it("stays one request up to the threshold", async () => {
    apiFetch.mockResolvedValue(json([]));
    await editSelected(PERSON_VIEW, handles(BULK_EDIT_BACKGROUND_FROM), [{ op: "remove_tag", handle: "T1" }]);
    expect(apiFetch.mock.calls[0][0]).toMatch(/\/api\/objects\/edit-by-handle\/$/);
  });

  it("throws the server's message, and a failed task's", async () => {
    apiFetch.mockResolvedValue(json({ message: "Tag T9 does not exist" }, 422));
    await expect(editSelected(PERSON_VIEW, handles(2), [{ op: "add_tag", handle: "T9" }])).rejects.toThrow("Tag T9 does not exist");

    apiFetch.mockResolvedValue(json({ task: { id: "t2" } }, 202));
    vi.mocked(waitForTask).mockResolvedValue({ state: "FAILURE", info: "boom", result_object: { error: "Database locked" } } as never);
    await expect(editSelected(PERSON_VIEW, handles(BULK_EDIT_BACKGROUND_FROM + 1), [{ op: "set_private", value: false }])).rejects.toThrow(
      "Database locked",
    );
  });

  it("doesn't offer tags or privacy for Tags themselves", () => {
    expect(supportsBulkEdit(PERSON_VIEW)).toBe(true);
    expect(supportsBulkEdit(TAG_VIEW)).toBe(false);
  });
});
