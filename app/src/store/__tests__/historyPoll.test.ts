import { describe, expect, it } from "vitest";
import { transactionsToNotifications } from "../historyPoll";

function change(obj_class: string, trans_type: number, obj_handle: string) {
  return { obj_class, trans_type, obj_handle };
}

describe("transactionsToNotifications", () => {
  it("maps obj_class/trans_type/obj_handle to table/op/handle", () => {
    expect(
      transactionsToNotifications([{ timestamp: 1, changes: [change("Person", 1, "H001")] }])
    ).toEqual([{ table: "person", handle: "H001", op: "UPDATE" }]);
  });

  it("drops reference-table changes (obj_class '7', REFERENCE_KEY)", () => {
    expect(
      transactionsToNotifications([{ timestamp: 1, changes: [change("7", 1, "H001")] }])
    ).toEqual([]);
  });

  it("collapses repeated changes to the same handle to their net (last) effect", () => {
    expect(
      transactionsToNotifications([
        { timestamp: 1, changes: [change("Person", 0, "H001")] },
        { timestamp: 2, changes: [change("Person", 1, "H001")] },
        { timestamp: 3, changes: [change("Person", 2, "H001")] },
      ])
    ).toEqual([{ table: "person", handle: "H001", op: "DELETE" }]);
  });

  it("keeps changes to different handles/classes separate", () => {
    expect(
      transactionsToNotifications([
        { timestamp: 1, changes: [change("Person", 1, "H001"), change("Family", 0, "F001")] },
      ])
    ).toEqual([
      { table: "person", handle: "H001", op: "UPDATE" },
      { table: "family", handle: "F001", op: "INSERT" },
    ]);
  });
});
