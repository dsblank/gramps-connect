import { describe, expect, it, vi } from "vitest";

vi.mock("../apiFetch", () => ({ apiFetch: vi.fn() }));
vi.mock("../../config", () => ({ API_BASE: "/api" }));

const { toEditEntries } = await import("../activityEdits");

const tx = (id: number, user: string | null, changes: [string, number, string][], extra = {}) => ({
  id,
  timestamp: id * 10 + 0.5,
  connection: { user: user === null ? null : { name: user } },
  changes: changes.map(([obj_class, trans_type, obj_handle]) => ({ obj_class, trans_type, obj_handle })),
  ...extra,
});

describe("toEditEntries", () => {
  it("keeps only this user's transactions, oldest first", () => {
    const entries = toEditEntries([
      tx(3, "alice", [["Person", 1, "P1"]]),
      tx(2, "bob", [["Person", 1, "P2"]]),
      tx(1, "alice", [["Event", 0, "E1"]]),
      tx(4, null, [["Person", 1, "P3"]]),
    ], "alice");
    expect(entries.map((e) => [e.txId, e.at, e.changes])).toEqual([
      [1, 10, [{ type: "event", handle: "E1", op: "added" }]],
      [3, 30, [{ type: "person", handle: "P1", op: "edited" }]],
    ]);
  });

  it("drops backlink rows and repeats, and transactions left empty", () => {
    const entries = toEditEntries([
      tx(1, "alice", [["Person", 1, "P1"], ["7", 1, "x"], ["Person", 1, "P1"], ["Family", 2, "F1"]]),
      tx(2, "alice", [["7", 0, "y"]]),
    ], "alice");
    expect(entries).toHaveLength(1);
    expect(entries[0].changes).toEqual([
      { type: "person", handle: "P1", op: "edited" },
      { type: "family", handle: "F1", op: "deleted" },
    ]);
  });

  it("marks undos", () => {
    expect(toEditEntries([tx(1, "alice", [["Person", 1, "P1"]], { undo: true })], "alice")[0].undo).toBe(true);
  });
});
