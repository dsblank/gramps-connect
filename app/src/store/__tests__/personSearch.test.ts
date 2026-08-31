import { describe, expect, it } from "vitest";
import { buildPersonSearchExpr } from "../personSearch";

describe("buildPersonSearchExpr", () => {
  it("returns null for empty or 1-character input", () => {
    expect(buildPersonSearchExpr("")).toBeNull();
    expect(buildPersonSearchExpr(" a ")).toBeNull();
  });

  it("ORs given_name/surname/gramps_id for a single word", () => {
    expect(buildPersonSearchExpr("Smith")).toBe(
      "(like(given_name, '%Smith%') or like(surname, '%Smith%') or like(gramps_id, '%Smith%'))"
    );
  });

  it("ANDs per-word clauses for multiple words, not assuming given vs. surname", () => {
    expect(buildPersonSearchExpr("john smith")).toBe(
      "(like(given_name, '%john%') or like(surname, '%john%') or like(gramps_id, '%john%')) and " +
        "(like(given_name, '%smith%') or like(surname, '%smith%') or like(gramps_id, '%smith%'))"
    );
  });

  it("drops commas rather than treating them as word boundaries with content", () => {
    expect(buildPersonSearchExpr("Smith, John")).toBe(
      "(like(given_name, '%Smith%') or like(surname, '%Smith%') or like(gramps_id, '%Smith%')) and " +
        "(like(given_name, '%John%') or like(surname, '%John%') or like(gramps_id, '%John%'))"
    );
  });

  it("strips quotes and backslashes rather than escaping them", () => {
    expect(buildPersonSearchExpr("O'Brien\\")).toBe(
      "(like(given_name, '%OBrien%') or like(surname, '%OBrien%') or like(gramps_id, '%OBrien%'))"
    );
  });

  // F8 (discussion #4) made this prefix-only; reverted (gramps-web-api
  // session 2026-08-31) -- see simpleSearch.ts's doc comment for the
  // benchmark that motivated it. given_name/surname/gramps_id are exactly
  // the flat, indexed columns where that benchmark found prefix vs. infix
  // cost within noise, so this was pure recall loss for no measured gain.
  it("is a contains-match, not prefix-only", () => {
    expect(buildPersonSearchExpr("mith")).toBe(
      "(like(given_name, '%mith%') or like(surname, '%mith%') or like(gramps_id, '%mith%'))"
    );
  });
});
