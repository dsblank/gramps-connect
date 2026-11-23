import { describe, expect, it } from "vitest";
import {
  NO_DATA_COLOR, OTHER_COLOR, UNCOLORED_TAG_COLOR, attributeTypesIn, buildAttributeColoring, buildTagColoring, textColorOn, toTagInfo,
  type TagInfo,
} from "../charts/personColors";
import type { TreePersonRaw } from "../store/treeData";

function person(handle: string, extra: Partial<TreePersonRaw> = {}): TreePersonRaw {
  return { handle, gramps_id: handle, gender: 1, ...extra };
}

function attr(type: string, value: string) {
  return { type, value };
}

describe("toTagInfo", () => {
  it("converts Gramps' 12-digit colors", () => {
    expect(toTagInfo({ handle: "t", name: "ToDo", color: "#efb60c280c28", priority: 3 })).toEqual({
      handle: "t", name: "ToDo", color: "#ef0c0c", priority: 3,
    });
  });

  it("keeps 6-digit colors, lowercased", () => {
    expect(toTagInfo({ handle: "t", color: "#AABBCC" }).color).toBe("#aabbcc");
  });

  it("gives Gramps' default black and missing colors a grey distinct from untagged", () => {
    expect(UNCOLORED_TAG_COLOR).not.toBe(NO_DATA_COLOR);
    expect(toTagInfo({ handle: "t", color: "#000000000000" }).color).toBe(UNCOLORED_TAG_COLOR);
    expect(toTagInfo({ handle: "t", color: "#000000" }).color).toBe(UNCOLORED_TAG_COLOR);
    expect(toTagInfo({ handle: "t" }).color).toBe(UNCOLORED_TAG_COLOR);
    expect(toTagInfo({ handle: "t", color: "red" }).color).toBe(UNCOLORED_TAG_COLOR);
  });
});

describe("buildTagColoring", () => {
  const tags = new Map<string, TagInfo>([
    ["a", { handle: "a", name: "Brick wall", color: "#ff0000", priority: 2 }],
    ["b", { handle: "b", name: "ToDo", color: "#00ff00", priority: 0 }],
    ["c", { handle: "c", name: "Unused", color: "#0000ff", priority: 1 }],
  ]);
  const people = [
    person("p1", { tag_list: ["a", "b"] }),
    person("p2", { tag_list: ["a"] }),
    person("p3", { tag_list: ["gone"] }),
    person("p4"),
  ];
  const c = buildTagColoring(people, tags);

  it("uses the lowest priority number, as Gramps does", () => {
    expect(c.colorFor(people[0])).toBe("#00ff00");
    expect(c.colorFor(people[1])).toBe("#ff0000");
  });

  it("gives untagged people and deleted tags no color", () => {
    expect(c.colorFor(people[2])).toBeNull();
    expect(c.colorFor(people[3])).toBeNull();
  });

  it("lists only tags that won somewhere, by priority, then No tag", () => {
    expect(c.legend).toEqual([
      { color: "#00ff00", label: "ToDo", count: 1 },
      { color: "#ff0000", label: "Brick wall", count: 1 },
      { color: NO_DATA_COLOR, label: "No tag", count: 2 },
    ]);
  });

  it("names every tag in the tooltip line, best first", () => {
    expect(c.detailFor(people[0])).toBe("Tags: ToDo, Brick wall");
    expect(c.detailFor(people[3])).toBeNull();
  });
});

describe("attributeTypesIn", () => {
  it("counts people (not attributes), skips empty values, most common first", () => {
    const people = [
      person("p1", { attribute_list: [attr("Level", "3"), attr("Level", "4"), attr("Nickname", "Bo")] }),
      person("p2", { attribute_list: [attr("Level", "1"), { type: { string: "Caste" }, value: "x" }] }),
      person("p3", { attribute_list: [attr("Nickname", "  ")] }),
    ];
    expect(attributeTypesIn(people)).toEqual([
      { type: "Level", count: 2 },
      { type: "Caste", count: 1 },
      { type: "Nickname", count: 1 },
    ]);
  });
});

describe("attributeTypesIn identifiers", () => {
  it("drops text types with a different value for everyone, keeps distinct numbers", () => {
    const people = Array.from({ length: 12 }, (_, i) =>
      person(`p${i}`, { attribute_list: [attr("_UID", `ABC-${i}`), attr("Score", String(i)), attr("Level", String(i % 3))] }),
    );
    expect(attributeTypesIn(people).map((a) => a.type)).toEqual(["Level", "Score"]);
  });

  it("keeps a unique text type when few people have it", () => {
    const people = ["a", "b", "c"].map((v) => person(v, { attribute_list: [attr("Nickname", v)] }));
    expect(attributeTypesIn(people).map((a) => a.type)).toEqual(["Nickname"]);
  });
});

describe("buildAttributeColoring", () => {
  it("shades numbers light to dark and lists each level", () => {
    const people = [1, 2, 3, 6].map((n) => person(`p${n}`, { attribute_list: [attr("Level", String(n))] }));
    people.push(person("none"));
    const c = buildAttributeColoring(people, "Level");
    expect(c.colorFor(people[0])).toBe("#86b6ef");
    expect(c.colorFor(people[3])).toBe("#0d366b");
    expect(c.colorFor(people[4])).toBeNull();
    expect(c.legend.map((e) => e.label)).toEqual(["1", "2", "3", "6", "Not recorded"]);
    expect(c.detailFor(people[1])).toBe("Level: 2");
  });

  it("shows just the ends for many distinct numbers", () => {
    const people = Array.from({ length: 12 }, (_, i) => person(`p${i}`, { attribute_list: [attr("Age", String(i * 10))] }));
    const c = buildAttributeColoring(people, "Age");
    expect(c.legend).toEqual([
      { color: "#86b6ef", label: "0" },
      { color: "#0d366b", label: "110" },
    ]);
  });

  it("puts a single number mid-ramp", () => {
    const c = buildAttributeColoring([person("p", { attribute_list: [attr("Level", "4")] })], "Level");
    expect(c.legend[0].color).toBe("#2a78d6");
  });

  it("gives text values palette slots, never a gradient", () => {
    const people = ["Farmer", "Weaver", "Farmer"].map((v, i) => person(`p${i}`, { attribute_list: [attr("Occupation", v)] }));
    const c = buildAttributeColoring(people, "Occupation");
    expect(c.legend).toEqual([
      { color: "#2a78d6", label: "Farmer", count: 2 },
      { color: "#eb6834", label: "Weaver", count: 1 },
    ]);
  });

  it("folds values past 8 into Other, keeping the most common", () => {
    const values = ["a", "b", "c", "d", "e", "f", "g", "h", "rare"];
    const people = values.flatMap((v) =>
      Array.from({ length: v === "rare" ? 1 : 2 }, (_, i) => person(`${v}${i}`, { attribute_list: [attr("X", v)] })),
    );
    const c = buildAttributeColoring(people, "X");
    expect(c.colorFor(people[people.length - 1])).toBe(OTHER_COLOR);
    expect(c.legend).toHaveLength(9);
    expect(c.legend[8]).toEqual({ color: OTHER_COLOR, label: "Other", count: 1 });
  });

  it("uses the first non-empty value when a type repeats", () => {
    const p = person("p", { attribute_list: [attr("Level", ""), attr("Level", "2"), attr("Level", "5")] });
    expect(buildAttributeColoring([p], "Level").detailFor(p)).toBe("Level: 2");
  });
});

describe("textColorOn", () => {
  it("picks dark text on light fills and light text on dark ones", () => {
    expect(textColorOn("#ffffcc").name).toBe("#0b0b0b");
    expect(textColorOn("#86b6ef").name).toBe("#0b0b0b");
    expect(textColorOn("#0d366b").name).toBe("#ffffff");
    expect(textColorOn("#8b0000").name).toBe("#ffffff");
  });
});
