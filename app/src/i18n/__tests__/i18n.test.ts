// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserLangToLocale } from "../i18n";

describe("browserLangToLocale", () => {
  it("maps every common Chinese tag onto our zh_CN/zh_TW/zh_HK codes", () => {
    for (const tag of ["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN", "zh-Hans-HK"]) {
      expect(browserLangToLocale(tag), tag).toBe("zh_CN");
    }
    for (const tag of ["zh-TW", "zh-Hant", "zh-Hant-TW"]) {
      expect(browserLangToLocale(tag), tag).toBe("zh_TW");
    }
    for (const tag of ["zh-HK", "zh-MO", "zh-Hant-HK", "zh-Hant-MO"]) {
      expect(browserLangToLocale(tag), tag).toBe("zh_HK");
    }
  });

  it("matches Norwegian Bokmål as nb, the code its lang file and gramps-core use", () => {
    expect(browserLangToLocale("nb-NO")).toBe("nb");
    expect(browserLangToLocale("nb")).toBe("nb");
  });

  it("keeps the full-code-then-base matching for everything else", () => {
    expect(browserLangToLocale("de-AT")).toBe("de_AT");
    expect(browserLangToLocale("de-CH")).toBe("de");
    expect(browserLangToLocale("pt-BR")).toBe("pt_BR");
    expect(browserLangToLocale("xx-YY")).toBeNull();
  });
});

describe("stored language preference", () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("migrates a code the old language list stored", async () => {
    localStorage.setItem("gramps-connect.lang", "zh_Hans");
    vi.resetModules();
    const { getI18nSnapshot } = await import("../i18n");
    expect(getI18nSnapshot().lang).toBe("zh_CN");
  });

  it("leaves a current code alone", async () => {
    localStorage.setItem("gramps-connect.lang", "zh_TW");
    vi.resetModules();
    const { getI18nSnapshot } = await import("../i18n");
    expect(getI18nSnapshot().lang).toBe("zh_TW");
  });
});
