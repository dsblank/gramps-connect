import { describe, expect, it } from "vitest";
import { preHistoryChange } from "../components/related/HistoryButton";
import type { ObjectChange } from "../store/historyApi";

function entry(trans_type: number, oldChange?: number): ObjectChange {
  return {
    id: 1,
    transaction_id: 1,
    obj_class: "Person",
    obj_handle: "h",
    trans_type,
    timestamp: 2000,
    old_data: oldChange === undefined ? null : { change: oldChange },
  };
}

describe("preHistoryChange", () => {
  it("uses the record's own change when nothing was logged (imported record)", () => {
    expect(preHistoryChange([], 0, 1500)).toBe(1500);
  });

  it("uses the oldest update's before-copy, not the current change", () => {
    expect(preHistoryChange([entry(1, 1900), entry(1, 1200)], 2, 2000)).toBe(1200);
  });

  it("shows nothing when the log reaches the record's creation", () => {
    expect(preHistoryChange([entry(1, 1900), entry(0)], 2, 2000)).toBeNull();
  });

  it("waits until the oldest page is loaded", () => {
    expect(preHistoryChange([entry(1, 1900)], 5, 2000)).toBeNull();
  });

  it("ignores a missing or zero change", () => {
    expect(preHistoryChange([], 0, 0)).toBeNull();
    expect(preHistoryChange([], 0, undefined)).toBeNull();
    expect(preHistoryChange([entry(1)], 1, 2000)).toBeNull();
  });
});
