import { describe, expect, it } from "vitest";
import { blank, type GrampsRecord, type Records } from "../board/records";
import { familyBetween, pathCards } from "../board/relationPath";

const person = (handle: string, extra: Record<string, unknown>) => blank<GrampsRecord>("Person", { handle, gramps_id: handle, ...extra });

/** Walter+Helen (F1) have John and Mary; John+Ruth (F2) have Anna; Mary+Tom (F3). */
const records: Records = Object.fromEntries(
  [
    person("walter", { family_list: ["F1"] }),
    person("helen", { family_list: ["F1"] }),
    person("john", { parent_family_list: ["F1"], family_list: ["F2"] }),
    person("mary", { parent_family_list: ["F1"], family_list: ["F3"] }),
    person("ruth", { family_list: ["F2"] }),
    person("anna", { parent_family_list: ["F2"] }),
    person("tom", { family_list: ["F3"] }),
  ].map((r) => [r.handle, r]),
);

describe("familyBetween", () => {
  it("finds the family for each kind of link", () => {
    expect(familyBetween("anna", "john", "parent", records)).toBe("F2");
    expect(familyBetween("walter", "john", "child", records)).toBe("F1");
    expect(familyBetween("john", "mary", "sibling", records)).toBe("F1");
    expect(familyBetween("mary", "tom", "spouse", records)).toBe("F3");
    expect(familyBetween("anna", "nobody", "parent", records)).toBeUndefined();
  });
});

describe("pathCards", () => {
  it("lists people and the families joining them, in order", () => {
    // Anna -> her father John -> his sister Mary -> her husband Tom.
    const steps = [
      { handle: "anna", link: null },
      { handle: "john", link: "parent" as const },
      { handle: "mary", link: "sibling" as const },
      { handle: "tom", link: "spouse" as const },
    ];
    expect(pathCards(steps, records).map((c) => `${c.cls}:${c.handle}`)).toEqual([
      "Person:anna", "Family:F2", "Person:john", "Family:F1", "Person:mary", "Family:F3", "Person:tom",
    ]);
  });

  it("lists a family once when it joins three people", () => {
    // Anna -> John (parent) -> Walter (parent) -> Mary (child), both through F1.
    const steps = [
      { handle: "anna", link: null },
      { handle: "john", link: "parent" as const },
      { handle: "walter", link: "parent" as const },
      { handle: "mary", link: "child" as const },
    ];
    expect(pathCards(steps, records).map((c) => c.handle)).toEqual(["anna", "F2", "john", "F1", "walter", "mary"]);
  });
});
