// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  exportLocalSettings,
  importLocalSettings,
  parseSettingsFile,
  resetLocalSettings,
  SettingsFileInvalid,
  settingsFileName,
} from "../localSettings";
import { STORAGE_KEYS } from "../storageKeys";

function seed() {
  localStorage.setItem(STORAGE_KEYS.columnWidths, '{"person":{"name":200}}');
  localStorage.setItem(STORAGE_KEYS.colorScheme, "dark");
  localStorage.setItem("gramps-connect:grampletWindowGeometry:g1", '{"left":1}');
  localStorage.setItem(STORAGE_KEYS.visited, '{"t:a":[]}');
  localStorage.setItem("some-other-app", "keep");
  sessionStorage.setItem(STORAGE_KEYS.token, "abc");
}

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof SettingsFileInvalid ? err.reason : "other";
  }
  return undefined;
}

describe("local settings", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    seed();
  });

  it("exports only settings, as raw strings", () => {
    const file = exportLocalSettings(new Date("2026-11-08T12:00:00Z"));
    expect(file.format).toBe("gramps-connect-settings");
    expect(file.version).toBe(1);
    expect(file.exported).toBe("2026-11-08T12:00:00.000Z");
    expect(file.settings).toEqual({
      [STORAGE_KEYS.colorScheme]: "dark",
      [STORAGE_KEYS.columnWidths]: '{"person":{"name":200}}',
      "gramps-connect:grampletWindowGeometry:g1": '{"left":1}',
    });
  });

  it("round-trips through reset and load", () => {
    const json = JSON.stringify(exportLocalSettings());
    resetLocalSettings();
    expect(exportLocalSettings().settings).toEqual({});
    importLocalSettings(parseSettingsFile(json).settings);
    expect(exportLocalSettings().settings).toEqual(JSON.parse(json).settings);
  });

  it("merges: settings not in the file stay", () => {
    importLocalSettings(parseSettingsFile(JSON.stringify({
      format: "gramps-connect-settings",
      version: 1,
      settings: { [STORAGE_KEYS.colorScheme]: "light", [STORAGE_KEYS.language]: "de" },
    })).settings);
    expect(localStorage.getItem(STORAGE_KEYS.colorScheme)).toBe("light");
    expect(localStorage.getItem(STORAGE_KEYS.language)).toBe("de");
    expect(localStorage.getItem(STORAGE_KEYS.columnWidths)).toBe('{"person":{"name":200}}');
  });

  it("skips unknown, excluded and non-string entries", () => {
    const { settings, skipped } = parseSettingsFile(JSON.stringify({
      format: "gramps-connect-settings",
      version: 1,
      settings: {
        [STORAGE_KEYS.language]: "de",
        [STORAGE_KEYS.visited]: "{}",
        [STORAGE_KEYS.token]: "stolen",
        "evil": "x",
        [STORAGE_KEYS.chartExport]: { not: "a string" },
      },
    }));
    expect(settings).toEqual({ [STORAGE_KEYS.language]: "de" });
    expect(skipped).toBe(4);
  });

  it("reset leaves Visited, sign-in and other sites alone", () => {
    resetLocalSettings();
    expect(localStorage.getItem(STORAGE_KEYS.visited)).toBe('{"t:a":[]}');
    expect(localStorage.getItem("some-other-app")).toBe("keep");
    expect(sessionStorage.getItem(STORAGE_KEYS.token)).toBe("abc");
    expect(localStorage.getItem(STORAGE_KEYS.columnWidths)).toBeNull();
  });

  it("rejects bad files", () => {
    expect(reasonOf(() => parseSettingsFile("{nope"))).toBe("notJson");
    expect(reasonOf(() => parseSettingsFile('{"format":"other","version":1}'))).toBe("wrongFormat");
    expect(reasonOf(() => parseSettingsFile("null"))).toBe("wrongFormat");
    expect(reasonOf(() => parseSettingsFile('{"format":"gramps-connect-settings","version":2,"settings":{}}'))).toBe("newerVersion");
  });

  it("names the file by local date", () => {
    expect(settingsFileName(new Date(2026, 10, 8))).toBe("gramps-connect-settings-2026-11-08.json");
  });
});
