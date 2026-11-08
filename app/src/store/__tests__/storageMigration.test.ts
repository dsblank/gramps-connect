// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { migrateStorageKeys } from "../storageMigration";

describe("migrateStorageKeys", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("moves old local and session keys to their new names", () => {
    localStorage.setItem("gramps-connect_column_widths", '{"person":{"name":200}}');
    localStorage.setItem("mantine-color-scheme-value", "dark");
    localStorage.setItem("gramps-connect.lang", "de");
    localStorage.setItem("gramps-connect_visited", "{}");
    sessionStorage.setItem("gramps-connect.token", "abc");
    sessionStorage.setItem("gramps-connect_nav_max", "3");
    migrateStorageKeys();
    expect(localStorage.getItem("gramps-connect:columnWidths")).toBe('{"person":{"name":200}}');
    expect(localStorage.getItem("gramps-connect:colorScheme")).toBe("dark");
    expect(localStorage.getItem("gramps-connect:language")).toBe("de");
    expect(localStorage.getItem("gramps-connect:visited")).toBe("{}");
    expect(sessionStorage.getItem("gramps-connect:token")).toBe("abc");
    expect(sessionStorage.getItem("gramps-connect:navMax")).toBe("3");
    expect(localStorage.getItem("gramps-connect_column_widths")).toBeNull();
    expect(localStorage.getItem("mantine-color-scheme-value")).toBeNull();
    expect(sessionStorage.getItem("gramps-connect.token")).toBeNull();
  });

  it("rewrites runtime-built key prefixes", () => {
    localStorage.setItem("gramps-connect:pyodidePocPanelCollapsed:person", "0");
    localStorage.setItem("gramps-connect:blog-draft:t1:alice", '{"title":"x"}');
    localStorage.setItem("gramps-connect:grampletWindowGeometry:g1", "{}");
    migrateStorageKeys();
    expect(localStorage.getItem("gramps-connect:viewGrampletPanelCollapsed:person")).toBe("0");
    expect(localStorage.getItem("gramps-connect:blogDraft:t1:alice")).toBe('{"title":"x"}');
    expect(localStorage.getItem("gramps-connect:grampletWindowGeometry:g1")).toBe("{}");
    expect(localStorage.getItem("gramps-connect:blog-draft:t1:alice")).toBeNull();
  });

  it("keeps an existing new key and is safe to repeat", () => {
    localStorage.setItem("gramps-connect.lang", "de");
    localStorage.setItem("gramps-connect:language", "fr");
    migrateStorageKeys();
    migrateStorageKeys();
    expect(localStorage.getItem("gramps-connect:language")).toBe("fr");
    expect(localStorage.getItem("gramps-connect.lang")).toBeNull();
    expect(localStorage.length).toBe(1);
  });
});
