import { describe, expect, it } from "vitest";

import { grampletOrderBy } from "../objectEndpoints";

describe("grampletOrderBy", () => {
  it("passes strings through, '-' meaning descending", () => {
    expect(grampletOrderBy(["surname", "-birth.date.sortval"])).toEqual(["surname", "-birth.date.sortval"]);
    expect(grampletOrderBy("-change")).toEqual(["-change"]);
  });

  it("converts the older column/direction dicts", () => {
    expect(grampletOrderBy([{ column: "surname", direction: "asc" }, { column: "change", direction: "desc" }]))
      .toEqual(["surname", "-change"]);
    expect(grampletOrderBy([{ column: "gramps_id" }])).toEqual(["gramps_id"]);
  });

  it("is undefined for no order", () => {
    expect(grampletOrderBy(null)).toBeUndefined();
    expect(grampletOrderBy(undefined)).toBeUndefined();
  });

  it("rejects anything else, naming it", () => {
    expect(() => grampletOrderBy([{ column: "surname", direction: "down" }])).toThrow(/"down"/);
    expect(() => grampletOrderBy([42])).toThrow(/42/);
    expect(() => grampletOrderBy({ column: "surname" })).toThrow(/must be a list/);
  });
});
