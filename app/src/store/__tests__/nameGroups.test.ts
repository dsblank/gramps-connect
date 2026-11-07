import { afterEach, describe, expect, it } from "vitest";
import { getNameGroup, groupSearchClauses, resetNameGroupsForTest } from "../nameGroups";
import { buildPersonSearchExpr } from "../personSearch";

afterEach(() => resetNameGroupsForTest());

describe("groupSearchClauses", () => {
  it("adds nothing before the lookups load, or when nothing matches", () => {
    expect(groupSearchClauses("smith")).toEqual([]);
    resetNameGroupsForTest({ mappings: [["Smyth", "Smith"]], groupAs: [["h1", "Smith"]] });
    expect(groupSearchClauses("jones")).toEqual([]);
  });

  it("matches tree-wide mappings and names' own Group as, case-insensitively and by substring", () => {
    resetNameGroupsForTest({
      mappings: [["Smyth", "Smith"], ["Smythe", "Smith"], ["Jonas", "Jones"]],
      groupAs: [["h1", "Smith"], ["h2", "Jones"]],
    });
    expect(groupSearchClauses("smi")).toEqual(['surname in ["Smyth","Smythe"]', 'handle in ["h1"]']);
  });

  it("searches the path directly when too many names set their own Group as", () => {
    resetNameGroupsForTest({ overflow: true });
    expect(groupSearchClauses("smith")).toEqual(["like(primary_name.group_as, '%smith%')"]);
  });

  it("feeds person search", () => {
    resetNameGroupsForTest({ mappings: [["Smyth", "Smith"]] });
    expect(buildPersonSearchExpr("Smith")).toBe(
      "(like(given_name, '%Smith%') or like(surname, '%Smith%') or like(gramps_id, '%Smith%') or surname in [\"Smyth\"])"
    );
    expect(getNameGroup("Smyth")).toBe("Smith");
    expect(getNameGroup("Smith")).toBeNull();
  });
});
