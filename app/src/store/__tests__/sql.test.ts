import { describe, expect, it } from "vitest";
import { createTableSql, insertSql, toRowValues, toSelectEntry, upsertSql } from "../sql";
import { MEDIA_VIEW, PERSON_VIEW, TAG_VIEW } from "../views";

describe("toSelectEntry", () => {
  it("passes a plain secondary-column select through unchanged", () => {
    const surname = PERSON_VIEW.columns.find((c) => c.key === "surname")!;
    expect(toSelectEntry(surname)).toBe("surname");
  });

  it("adds an `as` alias (from the column key) to a json_path select", () => {
    const birthDate = PERSON_VIEW.columns.find((c) => c.key === "birth_date")!;
    expect(toSelectEntry(birthDate)).toEqual({ json_path: ["birth", "date"], as: "birth_date" });
  });
});

describe("createTableSql", () => {
  it("includes every column, keyed on handle", () => {
    const sql = createTableSql(PERSON_VIEW);
    expect(sql).toContain("handle TEXT PRIMARY KEY");
    for (const col of PERSON_VIEW.columns) {
      expect(sql).toContain(`${col.key} ${col.sqlType}`);
    }
  });

  it("handles Media's reserved-word `desc` column without special-casing", () => {
    const sql = createTableSql(MEDIA_VIEW);
    expect(sql).toContain("desc TEXT");
  });

  it("handles Tag, which has no gramps_id column at all", () => {
    expect(PERSON_VIEW.columns.some((c) => c.key === "gramps_id")).toBe(true);
    expect(TAG_VIEW.columns.some((c) => c.key === "gramps_id")).toBe(false);
    const sql = createTableSql(TAG_VIEW);
    expect(sql).not.toContain("gramps_id");
  });
});

describe("insertSql / upsertSql", () => {
  it("insertSql uses a plain INSERT, upsertSql uses INSERT OR REPLACE, same column order", () => {
    const insert = insertSql(PERSON_VIEW);
    const upsert = upsertSql(PERSON_VIEW);
    expect(insert).toMatch(/^INSERT INTO person /);
    expect(upsert).toMatch(/^INSERT OR REPLACE INTO person /);

    const insertCols = insert.match(/\(([^)]+)\)/)![1];
    const upsertCols = upsert.match(/\(([^)]+)\)/)![1];
    expect(upsertCols).toBe(insertCols);
  });
});

describe("toRowValues", () => {
  it("applies a column's toSql converter (json_path date -> JSON string)", () => {
    const item = { handle: "H001", birth_date: { year: 1900, month: 1, day: 1 } };
    const values = toRowValues(PERSON_VIEW, item);
    const birthIndex = 1 + PERSON_VIEW.columns.findIndex((c) => c.key === "birth_date");
    expect(values[birthIndex]).toBe(JSON.stringify(item.birth_date));
  });

  it("passes a plain column through as-is, defaulting missing values to null", () => {
    const item = { handle: "H002", surname: "Ancestor" };
    const values = toRowValues(PERSON_VIEW, item);
    const surnameIndex = 1 + PERSON_VIEW.columns.findIndex((c) => c.key === "surname");
    const givenIndex = 1 + PERSON_VIEW.columns.findIndex((c) => c.key === "given_name");
    expect(values[surnameIndex]).toBe("Ancestor");
    expect(values[givenIndex]).toBeNull();
  });
});
