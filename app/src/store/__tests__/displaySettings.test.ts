import { afterEach, describe, expect, it, vi } from "vitest";
import { DateFormat } from "@gramps-connect/gramps-date";
import {
  DEFAULT_DISPLAY_SETTINGS,
  FULL_PLACE_FORMAT,
  isValidNameFormat,
  nameKeywordsToCodes,
  normalizeDisplaySettings,
  saveDisplaySettings,
} from "../displaySettings";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn(async () => "tok") }));

describe("normalizeDisplaySettings", () => {
  it("returns defaults for nothing stored", () => {
    expect(normalizeDisplaySettings(undefined)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(normalizeDisplaySettings("junk")).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("keeps valid values", () => {
    const custom = { name: "City", levels: "0", language: "de", street: 2, reverse: true };
    const settings = normalizeDisplaySettings({
      date: { format: DateFormat.ISO },
      name: { format: "%l, %f" },
      place: { auto: false, active: 1, formats: [FULL_PLACE_FORMAT, custom] },
    });
    expect(settings).toEqual({
      version: 1,
      date: { format: DateFormat.ISO },
      name: { format: "%l, %f" },
      place: { auto: false, active: 1, formats: [FULL_PLACE_FORMAT, custom] },
    });
  });

  it("falls back per field on bad values", () => {
    const settings = normalizeDisplaySettings({
      date: { format: 42 },
      name: { format: "<script>" },
      place: { auto: "yes", active: 7, formats: [FULL_PLACE_FORMAT, { name: 3 }, { name: "A", levels: ":", street: 9 }] },
    });
    expect(settings.date.format).toBe(DEFAULT_DISPLAY_SETTINGS.date.format);
    expect(settings.name.format).toBe("");
    expect(settings.place.auto).toBe(true);
    // The malformed entry is dropped, street clamps to 0, and the
    // out-of-range active index falls back to Full.
    expect(settings.place.formats).toEqual([FULL_PLACE_FORMAT, { name: "A", levels: ":", language: "", street: 0, reverse: false }]);
    expect(settings.place.active).toBe(0);
  });

  it("always pins Full as format 0", () => {
    const settings = normalizeDisplaySettings({ place: { formats: [{ name: "Edited", levels: "0", language: "", street: 0, reverse: false }] } });
    expect(settings.place.formats).toEqual([FULL_PLACE_FORMAT]);
  });
});

describe("isValidNameFormat", () => {
  it("accepts the built-ins and rejects other characters", () => {
    expect(isValidNameFormat("%1m %2m %o, %f %1y %s %0m")).toBe(true);
    expect(isValidNameFormat("")).toBe(true);
    expect(isValidNameFormat("%f-%l")).toBe(false);
  });
});

describe("saveDisplaySettings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves other keys in the tree config blob", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ other: { keep: 1 }, display: { version: 1 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const next = { ...DEFAULT_DISPLAY_SETTINGS, date: { format: DateFormat.ISO } };
    await saveDisplaySettings(next);
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(put[0]).toMatch(/\/api\/trees\/-\/config$/);
    expect(JSON.parse(put[1]!.body as string)).toEqual({ other: { keep: 1 }, display: next });
  });
});

describe("nameKeywordsToCodes", () => {
  it("converts desktop's keyword formats to %-codes", () => {
    expect(nameKeywordsToCodes("SURNAME, given (common)")).toBe("%L, %f (%x)");
    expect(nameKeywordsToCodes("Given Surname")).toBe("%f %l");
    // Longest keyword first: notpatronymic isn't eaten by patronymic.
    expect(nameKeywordsToCodes("notpatronymic patronymic[sur]")).toBe("%o %1y");
    expect(nameKeywordsToCodes('"%f %l"')).toBe("%f %l");
  });

  it("leaves unknown (e.g. translated) words, which then fail validation", () => {
    const converted = nameKeywordsToCodes("Nachname, Vorname");
    expect(isValidNameFormat(converted)).toBe(false);
  });
});
