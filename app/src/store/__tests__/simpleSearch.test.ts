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
});
