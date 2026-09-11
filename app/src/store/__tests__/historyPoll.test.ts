import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
}));

import { pollHistory, transactionsToNotifications } from "../historyPoll";

function change(obj_class: string, trans_type: number, obj_handle: string) {
  return { obj_class, trans_type, obj_handle };
}

describe("transactionsToNotifications", () => {
  it("maps obj_class/trans_type/obj_handle to table/op/handle, changedBy null with no connection", () => {
    expect(
      transactionsToNotifications([{ id: 1, timestamp: 1, changes: [change("Person", 1, "H001")] }])
    ).toEqual([{ table: "person", handle: "H001", op: "UPDATE", changedBy: null }]);
  });

  it("drops reference-table changes (obj_class '7', REFERENCE_KEY)", () => {
    expect(
      transactionsToNotifications([{ id: 1, timestamp: 1, changes: [change("7", 1, "H001")] }])
    ).toEqual([]);
  });

  it("collapses repeated changes to the same handle to their net (last) effect", () => {
    expect(
      transactionsToNotifications([
        { id: 1, timestamp: 1, changes: [change("Person", 0, "H001")] },
        { id: 2, timestamp: 2, changes: [change("Person", 1, "H001")] },
        { id: 3, timestamp: 3, changes: [change("Person", 2, "H001")] },
      ])
    ).toEqual([{ table: "person", handle: "H001", op: "DELETE", changedBy: null }]);
  });

  it("keeps changes to different handles/classes separate", () => {
    expect(
      transactionsToNotifications([
        { id: 1, timestamp: 1, changes: [change("Person", 1, "H001"), change("Family", 0, "F001")] },
      ])
    ).toEqual([
      { table: "person", handle: "H001", op: "UPDATE", changedBy: null },
      { table: "family", handle: "F001", op: "INSERT", changedBy: null },
    ]);
  });

  it("carries the transaction's connection.user.name through as changedBy", () => {
    expect(
      transactionsToNotifications([
        { id: 1, timestamp: 1, changes: [change("Person", 1, "H001")], connection: { user: { name: "alice" } } },
      ])
    ).toEqual([{ table: "person", handle: "H001", op: "UPDATE", changedBy: "alice" }]);
  });
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
  } as unknown as Response;
}

function response304() {
  return {
    ok: false,
    status: 304,
    headers: { get: () => null },
    json: async () => {
      throw new Error("304 has no body");
    },
  } as unknown as Response;
}

describe("pollHistory", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the prior ETag as If-None-Match, and a 304 skips onNotifications without advancing the cursor", async () => {
    fetchMock
      // bootstrap: newest existing transaction id
      .mockResolvedValueOnce(jsonResponse([{ id: 5, timestamp: 1, changes: [] }]))
      // first real poll: one new transaction, response carries an ETag
      .mockResolvedValueOnce(
        jsonResponse(
          [{ id: 6, timestamp: 2, changes: [change("Person", 1, "H1")] }],
          { ETag: '"v1"' }
        )
      )
      // second poll: nothing changed server-side
      .mockResolvedValueOnce(response304());

    const onNotifications = vi.fn();
    const stop = pollHistory(onNotifications);

    await vi.advanceTimersByTimeAsync(0);
    expect(onNotifications).toHaveBeenCalledTimes(1);
    expect(onNotifications).toHaveBeenCalledWith(
      [{ table: "person", handle: "H1", op: "UPDATE", changedBy: null }],
      6
    );
    expect(fetchMock.mock.calls[1][1].headers["If-None-Match"]).toBeUndefined();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers["If-None-Match"]).toBe('"v1"');
    expect(onNotifications).toHaveBeenCalledTimes(1);

    stop();
  });
});
