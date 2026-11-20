import { describe, expect, it } from "vitest";
import { sortByEventDate } from "../store/eventOrder";

const row = (id: string, sortval?: number) => ({ id, target: { date: sortval == null ? undefined : { sortval } } });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("sortByEventDate", () => {
  it("puts dated events in date order", () => {
    expect(ids(sortByEventDate([row("death", 300), row("birth", 100), row("baptism", 110)])))
      .toEqual(["birth", "baptism", "death"]);
  });
  it("keeps undated events in their own slots", () => {
    expect(ids(sortByEventDate([row("death", 300), row("occupation", 0), row("birth", 100), row("note")])))
      .toEqual(["birth", "occupation", "death", "note"]);
  });
  it("keeps stored order for equal dates and a missing target", () => {
    expect(ids(sortByEventDate([row("b", 5), { id: "x", target: undefined }, row("a", 5)])))
      .toEqual(["b", "x", "a"]);
  });
});
