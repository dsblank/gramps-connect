import { describe, expect, it } from "vitest";
import { shouldApplyNotification, type TreeChangeNotification } from "../liveSync";

const BASE: TreeChangeNotification = { treeid: 2, table: "person", handle: "H001", op: "UPDATE" };

describe("shouldApplyNotification", () => {
  it("rejects a notification for a different tree", () => {
    expect(
      shouldApplyNotification({ notification: { ...BASE, treeid: 99 }, myTreeId: 2, liveSyncViewKey: "person", viewWhereExpr: null })
    ).toBe(false);
  });

  it("rejects a notification for a table other than the live-sync-scoped view", () => {
    expect(
      shouldApplyNotification({ notification: { ...BASE, table: "family" }, myTreeId: 2, liveSyncViewKey: "person", viewWhereExpr: null })
    ).toBe(false);
  });

  it("rejects when the target view's cache is currently where_expr-filtered", () => {
    // A single thin {treeid, table, handle, op} notification can't tell
    // whether a changed row still belongs in a server-filtered subset --
    // see liveSync.ts's docstring.
    expect(
      shouldApplyNotification({ notification: BASE, myTreeId: 2, liveSyncViewKey: "person", viewWhereExpr: 'surname == "Smith"' })
    ).toBe(false);
  });

  it("accepts a matching-tree, matching-table notification against an unfiltered cache", () => {
    expect(
      shouldApplyNotification({ notification: BASE, myTreeId: 2, liveSyncViewKey: "person", viewWhereExpr: null })
    ).toBe(true);
  });
});
