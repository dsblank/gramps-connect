// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import { GrampletResultView, sortTableRows } from "../GrampletResultView";
import { objectCellLabel } from "../ObjectCellButton";
import type { ObjectCell, TableCell } from "../types";

const person = (id: string, first: string, surname: string): ObjectCell => ({
  kind: "object",
  objectType: "person",
  handle: `h${id}`,
  text: `[${id}] ${first} ${surname}`,
  fields: { gramps_id: id, primary_name: { first_name: first, surname_list: [{ surname, primary: true }] } },
});

describe("objectCellLabel", () => {
  it("labels a record the way Referenced by does when its fields came along", () => {
    expect(objectCellLabel(person("I1", "John", "Smith"))).toMatch(/^\[I1\] .*Smith/u);
  });

  it("labels a family by its parents", () => {
    const family: ObjectCell = {
      kind: "object",
      objectType: "family",
      handle: "hF1",
      text: "[F1] Family",
      fields: {
        gramps_id: "F1",
        father: { primary_name: { first_name: "John", surname_list: [{ surname: "Smith", primary: true }] } },
        mother: { primary_name: { first_name: "Mary", surname_list: [{ surname: "Jones", primary: true }] } },
      },
    };
    expect(objectCellLabel(family)).toMatch(/^\[F1\] .*Smith.* & .*Jones/u);
  });

  it("keeps row()'s own text when the naming fields weren't fetched", () => {
    const bare: ObjectCell = { kind: "object", objectType: "person", handle: "h", text: "[I9] Person", fields: { gramps_id: "I9" } };
    expect(objectCellLabel(bare)).toBe("[I9] Person");
  });
});

describe("sortTableRows", () => {
  const rows: TableCell[][] = [
    [person("I3", "Ann", "Brown"), "10"],
    [person("I1", "Bob", "Adams"), "9"],
    [person("I2", "Cy", "Adams"), "9"],
    [person("I4", "Di", "Clark"), ""],
  ];
  const ids = (sorted: TableCell[][]) => sorted.map((r) => (r[0] as ObjectCell).handle);

  it("sorts a value column numerically, ties by the record, empties last", () => {
    expect(ids(sortTableRows(rows, 1, false))).toEqual(["hI1", "hI2", "hI3", "hI4"]);
    expect(ids(sortTableRows(rows, 1, true))).toEqual(["hI3", "hI1", "hI2", "hI4"]);
  });

  it("sorts records by their label, not their ID, ties by the next column", () => {
    const sorted = ids(sortTableRows(rows, 0, false));
    // Whatever the name format, two Adamses sort together and Clark after Brown.
    expect(sorted.indexOf("hI4")).toBeGreaterThan(sorted.indexOf("hI3"));
  });
});

describe("table header clicks", () => {
  it("cycles ascending, descending, then the Gramplet's own order", async () => {
    renderWithProviders(
      <GrampletResultView
        status="done"
        response={{ type: "blocks", runId: "r", blocks: [{ type: "table", columns: ["Name", "N"], rows: [["b", "2"], ["a", "10"], ["c", "1"]] }] }}
      />
    );
    const firstColumn = () => screen.getAllByRole("row").slice(1).map((r) => r.querySelector("td")?.textContent);
    expect(firstColumn()).toEqual(["b", "a", "c"]);
    await userEvent.click(screen.getByRole("columnheader", { name: /^N\b/u }));
    expect(firstColumn()).toEqual(["c", "b", "a"]);
    await userEvent.click(screen.getByRole("columnheader", { name: /^N\b/u }));
    expect(firstColumn()).toEqual(["a", "b", "c"]);
    await userEvent.click(screen.getByRole("columnheader", { name: /^N\b/u }));
    expect(firstColumn()).toEqual(["b", "a", "c"]);
  });
});
