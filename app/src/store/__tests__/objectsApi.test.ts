import { describe, expect, it } from "vitest";
import { repairForSave } from "../objectsApi";

describe("repairForSave", () => {
  it("turns a null LDS ordinance place into Gramps' empty place", () => {
    const person = {
      _class: "Person",
      handle: "h",
      lds_ord_list: [
        { _class: "LdsOrd", place: null, famc: null, temple: "ADELA" },
        { _class: "LdsOrd", place: "p1", famc: "f1" },
      ],
    };
    expect(repairForSave(person)).toEqual({
      ...person,
      lds_ord_list: [
        // famc is schema-nullable, so it stays null
        { _class: "LdsOrd", place: "", famc: null, temple: "ADELA" },
        { _class: "LdsOrd", place: "p1", famc: "f1" },
      ],
    });
  });

  it("does not mutate the caller's object", () => {
    const ord = { _class: "LdsOrd", place: null };
    const family = { _class: "Family", lds_ord_list: [ord] };
    repairForSave(family);
    expect(ord.place).toBeNull();
    expect(family.lds_ord_list[0]).toBe(ord);
  });

  it("returns the same object when there's nothing to repair", () => {
    const place = { _class: "Place", handle: "h", title: "x" };
    expect(repairForSave(place)).toBe(place);
    const person = { _class: "Person", lds_ord_list: [{ place: "" }] };
    expect(repairForSave(person)).toBe(person);
  });
});
