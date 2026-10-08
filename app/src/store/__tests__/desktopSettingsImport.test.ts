// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { DateFormat, loadLocale } from "@gramps-connect/gramps-date";
import {
  DESKTOP_DATE_FORMATS,
  applyImport,
  buildImportItems,
  desktopLanguageFor,
  parseGrampsIni,
  parsePlaceFormatsXml,
  parsePyLiteral,
  type ImportInput,
} from "../desktopSettingsImport";
import { DEFAULT_DISPLAY_SETTINGS, FULL_PLACE_FORMAT, type CustomNameFormat } from "../displaySettings";

// Languages other than English load on demand.
beforeAll(async () => {
  await Promise.all(["de", "fr", "sv"].map((code) => loadLocale(code)));
});

// Shaped like a real ConfigManager save: header comments, defaults written
// as ;;key=value, repr() values, booleans as ints.
const INI = `;; Gramps key file
;; Automatically created at 2026/10/06 10:00:00

[behavior]
;;addons-url='https://example.org'

[preferences]
date-format=4
;;name-format=1
place-auto=0
place-format=2
iprefix='I%04d'
`;

const XML = `<?xml version="1.0" encoding="utf-8"?>
<place_formats>
  <format name="Full" levels=":" language="" street="0" reverse="False"/>
  <format name="City" levels="0" language="" street="0" reverse="False"/>
  <format name="Street" levels=":" language="de" street="2" reverse="True"/>
</place_formats>`;

function input(overrides: Partial<ImportInput> = {}): ImportInput {
  return {
    ini: parseGrampsIni(INI),
    placeFormats: parsePlaceFormatsXml(XML),
    desktopLanguage: "en",
    customNameFormats: [],
    dateFormatLabel: (f) => DateFormat[f],
    ...overrides,
  };
}

describe("parseGrampsIni", () => {
  it("reads sections, marks ;; defaults, skips header comments", () => {
    const ini = parseGrampsIni(INI);
    expect(ini.get("preferences.date-format")).toEqual({ raw: "4", isDefault: false });
    expect(ini.get("preferences.name-format")).toEqual({ raw: "1", isDefault: true });
    expect(ini.get("behavior.addons-url")?.isDefault).toBe(true);
    expect([...ini.keys()].every((k) => k.includes("."))).toBe(true);
  });

  it("parses Python literals without evaluating", () => {
    expect(parsePyLiteral("'I%04d'")).toBe("I%04d");
    expect(parsePyLiteral("True")).toBe(true);
    expect(parsePyLiteral("-3")).toBe(-3);
    expect(parsePyLiteral("[1, 2]")).toBeNull();
    expect(parsePyLiteral("__import__('os')")).toBeNull();
  });
});

describe("parsePlaceFormatsXml", () => {
  it("reads formats", () => {
    expect(parsePlaceFormatsXml(XML)[2]).toEqual({ name: "Street", levels: ":", language: "de", street: 2, reverse: true });
  });
  it("rejects other files", () => {
    expect(() => parsePlaceFormatsXml("<foo/>")).toThrow();
    expect(() => parsePlaceFormatsXml("not xml")).toThrow();
  });
});

describe("buildImportItems / applyImport", () => {
  it("imports everything usable", () => {
    const items = buildImportItems(input());
    expect(items.map((i) => i.key)).toEqual(["date", "name", "placeAuto", "placeFormats", "placeActive", "ids"]);
    expect(items.find((i) => i.key === "name")!.isDefault).toBe(true);
    const result = applyImport(DEFAULT_DISPLAY_SETTINGS, items, new Set(items.map((i) => i.key)));
    expect(result.date.format).toBe(DateFormat.DAY_LONG_MONTH_YEAR);
    expect(result.name.format).toBe("%l, %f %s");
    expect(result.place.auto).toBe(false);
    expect(result.place.formats.map((f) => f.name)).toEqual(["Full", "City", "Street"]);
    expect(result.place.active).toBe(2);
    // Only iprefix is in the file; the others stay as they were.
    expect(result.ids.person).toBe("I%04d");
    expect(result.ids.family).toBe("");
  });

  it("imports ID templates, marking an all-defaults set", () => {
    const ini = parseGrampsIni("[preferences]\n;;iprefix='I%04d'\nfprefix='FAM%05d'\noprefix='bad'\n");
    const item = buildImportItems(input({ ini })).find((i) => i.key === "ids")!;
    expect(item.isDefault).toBe(false);
    expect(item.reason).toMatch(/can't be used/);
    const result = applyImport(DEFAULT_DISPLAY_SETTINGS, [item], new Set(["ids"]));
    expect(result.ids).toMatchObject({ person: "I%04d", family: "FAM%05d", media: "" });
    const defaults = parseGrampsIni("[preferences]\n;;iprefix='I%04d'\n;;fprefix='F%04d'\n");
    expect(buildImportItems(input({ ini: defaults })).find((i) => i.key === "ids")!.isDefault).toBe(true);
  });

  it("maps the date index through the desktop language", () => {
    // French #4 is "Jour. Mois Année", not English's "Day Month Year"... which
    // happens to be the same shape; #2 is where they differ.
    const ini = parseGrampsIni("[preferences]\ndate-format=2\n");
    const fr = buildImportItems(input({ ini, desktopLanguage: "fr" }));
    const en = buildImportItems(input({ ini, desktopLanguage: "en" }));
    const apply = (items: typeof fr) => applyImport(DEFAULT_DISPLAY_SETTINGS, items, new Set(["date"])).date.format;
    expect(apply(fr)).toBe(DateFormat.DAY_LONG_MONTH_YEAR);
    expect(apply(en)).toBe(DateFormat.LONG_MONTH_DAY_YEAR);
    // Swedish's #2 is its own year-first layout, ported too.
    const sv = buildImportItems(input({ ini, desktopLanguage: "sv" }));
    expect(sv[0].usable).toBe(true);
    expect(sv[0].desktop).toContain("1854 Mars 12");
  });

  it("taking the active place format takes the imported list with it", () => {
    const items = buildImportItems(input());
    const result = applyImport(DEFAULT_DISPLAY_SETTINGS, items, new Set(["placeActive"]));
    expect(result.place.formats.map((f) => f.name)).toEqual(["Full", "City", "Street"]);
    expect(result.place.active).toBe(2);
  });

  it("takes a ported language's own format exactly, including one only it has", () => {
    const ini = parseGrampsIni("[preferences]\ndate-format=6\n");
    const [item] = buildImportItems(input({ ini, desktopLanguage: "de" }));
    expect(item.usable).toBe(true);
    expect(item.desktop).toContain("12.03.1854");
    const result = applyImport(DEFAULT_DISPLAY_SETTINGS, [item], new Set(["date"]));
    expect(result.date).toEqual({ format: DEFAULT_DISPLAY_SETTINGS.date.format, byLanguage: { de: 6 } });
  });

  it("needs place_formats.xml for a non-Full active format", () => {
    const items = buildImportItems(input({ placeFormats: null }));
    const active = items.find((i) => i.key === "placeActive")!;
    expect(active.usable).toBe(false);
    expect(active.reason).toMatch(/place_formats\.xml/);
    expect(items.some((i) => i.key === "placeFormats")).toBe(false);
  });

  it("resolves a negative name format against the tree's custom formats", () => {
    const ini = parseGrampsIni("[preferences]\nname-format=-1\n");
    const custom: CustomNameFormat[] = [{ number: -1, name: "Mine", format: "%L, %f", original: "SURNAME, given", usable: true }];
    const ok = buildImportItems(input({ ini, customNameFormats: custom }));
    expect(applyImport(DEFAULT_DISPLAY_SETTINGS, ok, new Set(["name"])).name.format).toBe("%L, %f");
    const missing = buildImportItems(input({ ini, customNameFormats: [] }));
    expect(missing[0].usable).toBe(false);
  });

  it("keeps our Full as format 0 even if the XML's differs", () => {
    const xml = XML.replace('name="Full" levels=":"', 'name="Edited" levels="0"');
    const items = buildImportItems(input({ placeFormats: parsePlaceFormatsXml(xml) }));
    const result = applyImport(DEFAULT_DISPLAY_SETTINGS, items, new Set(["placeFormats"]));
    expect(result.place.formats[0]).toEqual(FULL_PLACE_FORMAT);
  });
});

describe("desktopLanguageFor", () => {
  it("maps UI languages", () => {
    // Every Gramps language is a gramps-date locale, regional ones included.
    expect(desktopLanguageFor("de_AT")).toBe("de_AT");
    expect(desktopLanguageFor("de-CH")).toBe("de");
    expect(desktopLanguageFor("zh_CN")).toBe("zh_CN");
    expect(desktopLanguageFor("nn")).toBe("nn");
    expect(desktopLanguageFor("xx")).toBe("en");
    expect(Object.values(DESKTOP_DATE_FORMATS).every((l) => l.formats[0] === DateFormat.ISO)).toBe(true);
  });
});
