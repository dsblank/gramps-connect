import { describe, expect, it } from "vitest";
import { buildSimpleSearchExpr } from "../simpleSearch";

describe("buildSimpleSearchExpr", () => {
  it("returns null for empty or 1-character input", () => {
    const build = buildSimpleSearchExpr(["gramps_id", "title"]);
    expect(build("")).toBeNull();
    expect(build(" a ")).toBeNull();
  });

  it("ORs a like() clause per field", () => {
    const build = buildSimpleSearchExpr(["gramps_id", "title"]);
    expect(build("Chicago")).toBe("like(gramps_id, '%Chicago%') or like(title, '%Chicago%')");
  });

  it("supports a relationship-hop field path", () => {
    const build = buildSimpleSearchExpr(["father.surname"]);
    expect(build("Smith")).toBe("like(father.surname, '%Smith%')");
  });

  it("strips quotes and backslashes rather than escaping them", () => {
    const build = buildSimpleSearchExpr(["name"]);
    expect(build("O'Brien\\")).toBe("like(name, '%OBrien%')");
  });

  // F8 (discussion #4) made this prefix-only for an index-backed scan;
  // reverted (gramps-web-api session 2026-08-31) once benchmarking against
  // the 100k-row bench fixtures showed prefix vs. infix cost was within
  // noise on every field these builders actually target -- see
  // simpleSearch.ts's own doc comment for the numbers. A contains-match
  // finding a field's *middle*, not just its start, was the whole point of
  // reverting, so this now asserts the opposite of the old rule.
  it("is a contains-match, not prefix-only", () => {
    const build = buildSimpleSearchExpr(["title"]);
    expect(build("hicag")).toBe("like(title, '%hicag%')");
  });
});
