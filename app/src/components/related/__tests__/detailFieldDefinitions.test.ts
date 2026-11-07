import { describe, expect, it } from "vitest";
import { DETAIL_FIELDS } from "../detailFieldDefinitions";
import type { ObjectDetail } from "../../../store/objectDetail";

const EMPTY_DATE = { _class: "Date", calendar: 0, modifier: 0, quality: 0, dateval: [0, 0, 0, false], text: "", sortval: 0, newyear: 0 };

function personFields(primary_name: Record<string, unknown>): Record<string, string> {
  const detail = { handle: "h", primary_name } as unknown as ObjectDetail;
  const out: Record<string, string> = {};
  for (const f of DETAIL_FIELDS.person) {
    const value = f.value(detail);
    if (value) out[f.label] = value;
  }
  return out;
}

const base = {
  first_name: "John", surname_list: [{ surname: "Smith", primary: true }],
  type: "Birth Name", date: EMPTY_DATE,
};

describe("person detail fields", () => {
  it("shows name parts the tree's format (%l, %f %s) leaves out", () => {
    expect(personFields({ ...base, title: "Dr.", suffix: "Jr.", call: "Jack", nick: "Jackie", famnick: "Smitty" })).toEqual({
      Title: "Dr.", "Call name": "Jack", Nickname: "Jackie", "Family nickname": "Smitty",
    });
  });

  it("shows nothing extra for a plain birth name", () => {
    expect(personFields(base)).toEqual({});
  });

  it("shows suffix when the name's own format leaves it out", () => {
    expect(personFields({ ...base, suffix: "Jr.", display_as: 4 })).toEqual({ Suffix: "Jr." });
  });

  it("shows a non-birth name type", () => {
    expect(personFields({ ...base, type: "Married Name" })).toEqual({ "Name type": "Married Name" });
  });
});
