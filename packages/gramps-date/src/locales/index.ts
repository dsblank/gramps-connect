// Every language gramps-date can load: strings generated from a live Gramps
// (<code>.generated.ts, listed in available.generated.ts) plus, for the
// languages whose Gramps displayer lays out dates its own way, the layouts
// below -- everything else uses Gramps' base layouts, as its displayer does.
// Checked against Gramps' own output by __tests__/locales.test.ts and
// __tests__/grampsTests.test.ts.

import type { DateLocale } from "../locale";
import { Modifier, Quality, type DatePart } from "../types";
import type { GregorianLayout } from "../layouts";
import { DateFormat } from "../formats";
import { LOCALE_LOADERS } from "./available.generated";
import { fromGramps, IDENTITY_FORMAT_INDEX } from "./fromGramps";
import { ZH_CN_WORDS, ZH_TW_WORDS, zhLayout } from "./zh";
import { KO_LUNAR_STYLE, VI_LUNAR_STYLE } from "./lunar";

interface LocaleLayout {
  /** See DateLocale.numericLstrip. */
  numericLstrip?: boolean;
  /** See DateLocale.layoutsForAllCalendars. */
  layoutsForAllCalendars?: boolean;
  /** The language's layouts, or a function adjusting its base ones. */
  gregorianLayouts?: readonly GregorianLayout[] | ((base: readonly GregorianLayout[]) => readonly GregorianLayout[]);
  /** DateFormat (the six shared formats) -> this language's format number. */
  formatIndex?: Readonly<Record<number, number>>;
  /** A port of the displayer's display(), for wording templates can't
   * express (see DateLocale.display). */
  display?: DateLocale["display"];
  /** See DateLocale.lunarStyle. */
  lunarStyle?: DateLocale["lunarStyle"];
  /** See DateLocale.compoundQualityModifiers. */
  compoundQualityModifiers?: DateLocale["compoundQualityModifiers"];
}

/** A language's own month-name layout (`%d. %s %s` and the like in its
 * _display_gregorian -- literal, not translated, and no year localization). */
function own(
  months: "long" | "short" | "roman" | "number",
  template: string,
  extra: Partial<Extract<GregorianLayout, { kind: "text" }>> = {},
): GregorianLayout {
  return { kind: "text", months, template, base: false, ...extra };
}

/** Format-number maps for languages whose lists differ from the base's:
 * [ISO, NUMERIC, LONG_MONTH_DAY_YEAR, SHORT_MONTH_DAY_YEAR,
 * DAY_LONG_MONTH_YEAR, DAY_SHORT_MONTH_YEAR] -> the language's nearest. */
function formatMap(iso: number, numeric: number, longMdy: number, shortMdy: number, dayLong: number, dayShort: number): Record<number, number> {
  return {
    [DateFormat.ISO]: iso,
    [DateFormat.NUMERIC]: numeric,
    [DateFormat.LONG_MONTH_DAY_YEAR]: longMdy,
    [DateFormat.SHORT_MONTH_DAY_YEAR]: shortMdy,
    [DateFormat.DAY_LONG_MONTH_YEAR]: dayLong,
    [DateFormat.DAY_SHORT_MONTH_YEAR]: dayShort,
  };
}

const ISO: GregorianLayout = { kind: "iso" };

/** _date_he.py's add_prefix: a one-letter Hebrew preposition joined to the
 * date, with a maqaf when the date starts with a non-Hebrew character. */
function hebrewPrefix(text: string, prefix: string): string {
  return text[0] < "א" || text[0] > "ת" ? `${prefix}־${text}` : prefix + text;
}

/** Base layouts with some text layouts' options changed. */
function adjust(changes: Record<number, Partial<Extract<GregorianLayout, { kind: "text" }>>>) {
  return (base: readonly GregorianLayout[]) =>
    base.map((layout, index) => (layout.kind === "text" && changes[index] ? { ...layout, ...changes[index] } : layout));
}

const CUSTOM_LAYOUTS: Readonly<Record<string, LocaleLayout>> = {
  // DateDisplayZH_CN / ZH_TW (_date_zh_CN.py, _date_zh_TW.py; zh_HK uses
  // the Traditional handler): see zh.ts.
  zh_CN: zhLayout(ZH_CN_WORDS),
  zh_TW: zhLayout(ZH_TW_WORDS),
  zh_HK: zhLayout(ZH_TW_WORDS),
  // DateDisplayKO._display_korean_lunar / DateDisplayVI._display_vietnamese_lunar:
  // their own lunar calendar written their own way (see lunar.ts).
  ko: { lunarStyle: KO_LUNAR_STYLE },
  vi: { lunarStyle: VI_LUNAR_STYLE },
  // DateDisplayRU (_date_ru.py): day-first dates always take the genitive
  // ("4 марта 1789"), whatever precedes them; for every calendar.
  ru: {
    layoutsForAllCalendars: true,
    gregorianLayouts: (base) => [
      ...base.slice(0, 4),
      own("long", "{day} {long_month} {year}", { dayForm: "Р" }),
      // Gramps tests hasattr(month, "f") here -- a typo for "forms", never
      // true, so it shows "4 май 1789" for the intended "4 мая 1789" (a
      // Gramps bug, fixed).
      own("short", "{day} {short_month} {year}", { dayForm: "Р" }),
    ],
  },
  // DateDisplayFI (_date_fi.py): three formats; the third, for every
  // calendar, is "4. maaliskuuta 1789" (partitive), "maaliskuussa 1789"
  // (inessive) for a plain month and year, and numeric for a day date in a
  // month list without forms. (Gramps raises for a plain month and year
  // there; the uninflected name is used.)
  fi: {
    layoutsForAllCalendars: true,
    gregorianLayouts: [
      ISO,
      { kind: "baseNumeric" },
      own("long", "{day}. {long_month} {year}", { dayForm: "P", monthYearForm: "IN", numericWhenUninflected: true }),
    ],
    formatIndex: formatMap(0, 1, 2, 2, 2, 2),
  },
  // DateDisplayHR (_date_hr.py): a dot after a short month's year
  // ("ožu. 1789."), for every calendar; the long month's comes with its
  // translated form.
  hr: {
    layoutsForAllCalendars: true,
    gregorianLayouts: adjust({ 3: { monthYear: "{month} {year}." }, 5: { monthYear: "{month} {year}." } }),
  },
  // DateDisplayNb.dd_dformat01 (_date_nb.py): the numeric format, left-
  // trimmed -- "%d. %b %Y" without a day would start with a space. Also nn.
  nb: { numericLstrip: true },
  // DateDisplayNL (_date_nl.py): numeric keeps a zero day ("0/11/1789") and
  // turns "-" into "/"; month names in literal (untranslated) patterns.
  nl: {
    gregorianLayouts: [
      ISO,
      { kind: "numeric", pad: false, isoWhenBce: false, absYear: true, dashToSlash: true },
      own("long", "{long_month} {day}, {year}"),
      own("short", "{short_month} {day}, {year}"),
      own("long", "{day} {long_month} {year}"),
      own("short", "{day} {short_month} {year}"),
    ],
  },
  // DateDisplayEL (_date_el.py): two month-number formats ("4-11-1789",
  // "4/11/1789"), then long and short month names, day first.
  el: {
    gregorianLayouts: [
      ISO,
      own("number", "{day}-{month}-{year}", { monthYear: "{month}-{year}" }),
      own("number", "{day}/{month}/{year}", { monthYear: "{month}/{year}" }),
      own("long", "{day} {long_month} {year}"),
      own("short", "{day} {short_month} {year}"),
    ],
    formatIndex: formatMap(0, 1, 3, 4, 3, 4),
  },
  // DateDisplayLT (_date_lt.py): year first, "1789 m. kovo 4 d." with the
  // genitive month, and the nominative list for a month and year.
  lt: {
    gregorianLayouts: [
      ISO,
      { kind: "baseNumeric" },
      own("long", "{year} m. {long_month} {day} d.", { monthYear: "{year} m. {month}", monthYearMonths: "altLong" }),
      own("short", "{short_month} {day}, {year}"),
    ],
    formatIndex: formatMap(0, 1, 2, 3, 2, 3),
  },
  // DateDisplayPL (_date_pl.py): a month-first number format ("11.4.1789")
  // and Roman-numeral months ("4 XI 1789"). Numeric BCE years unsigned:
  // Gramps writes them signed, which doesn't read back (fixed).
  pl: {
    gregorianLayouts: [
      ISO,
      { kind: "numeric", pad: false, isoWhenBce: false, absYear: true },
      own("long", "{long_month} {day}, {year}"),
      own("number", "{month}.{day}.{year}", { monthYear: "{month}.{year}" }),
      own("long", "{day} {long_month} {year}"),
      own("roman", "{day} {month} {year}"),
    ],
  },
  // DateDisplaySR_Base (_date_sr.py): "4. јан 1789." -- dots after the day
  // and the year -- and Roman-numeral months. Also sr_Latn.
  sr: {
    gregorianLayouts: [
      ISO,
      { kind: "numeric", pad: false, isoWhenBce: false, absYear: true },
      own("short", "{day}. {short_month} {year}.", { monthYear: "{month} {year}.", yearOnly: "{year}." }),
      own("long", "{day}. {long_month} {year}.", { monthYear: "{month} {year}.", yearOnly: "{year}." }),
      own("roman", "{day}. {month} {year}.", { monthYear: "{month} {year}.", yearOnly: "{year}." }),
    ],
    formatIndex: formatMap(0, 1, 3, 2, 3, 2),
  },
  // DateDisplayHU._display_calendar (_date_hu.py), for every calendar: year
  // first, "1789. november 04.", zero-padded. (Gramps uses Gregorian month
  // names for every calendar there; each calendar's own here.)
  hu: {
    layoutsForAllCalendars: true,
    gregorianLayouts: [
      ISO,
      own("number", "{year}. {month:02d}. {day:02d}.", { monthYear: "{year}. {month:02d}.", isoWhenSlash: true }),
      own("long", "{year}. {long_month} {day:02d}.", { monthYear: "{year}. {month}" }),
      own("short", "{year}. {short_month} {day:02d}.", { monthYear: "{year}. {month}" }),
      own("roman", "{year}. {month} {day:02d}.", { monthYear: "{year}. {month}" }),
    ],
    formatIndex: formatMap(0, 1, 2, 3, 2, 3),
  },
  // DateDisplaySv._display_calendar (_date_sv.py), for every calendar: year
  // first, "1789 november 4".
  sv: {
    layoutsForAllCalendars: true,
    gregorianLayouts: [
      ISO,
      { kind: "baseNumeric" },
      own("long", "{year} {long_month} {day}", { monthYear: "{year} {month}" }),
      own("short", "{year} {short_month} {day}", { monthYear: "{year} {month}" }),
    ],
    formatIndex: formatMap(0, 1, 2, 3, 2, 3),
  },
  // DateDisplayJA (_date_ja.py): "1789年11月4日"; numeric drops a zero day
  // with its "日" and shows BCE and dual years as ISO.
  ja: {
    gregorianLayouts: [
      ISO,
      { kind: "numeric", pad: false, isoWhenBce: true, dropZeroDay: true },
      own("short", "{year}年{short_month}{day}日", { monthYear: "{year}年{month}", yearOnly: "{year}年" }),
      own("long", "{year}年{long_month}{day}日", { monthYear: "{year}年{month}", yearOnly: "{year}年" }),
    ],
    formatIndex: formatMap(0, 1, 3, 2, 3, 2),
  },
  nn: { numericLstrip: true },
  // DateDisplayHE.display (_date_he.py): prepositions are prefixes --
  // "ב" ("in") when there's no day or there's a quality, "מ"/"ל" on a
  // span's start / range's end, a modifier word joined when it has no
  // trailing space.
  he: {
    display(date, { locale, part, extras }) {
      const qualStr = locale.qualityStrings[date.quality] ?? "";
      const scal = extras(date.calendar, date.newyear);
      const start = date.dateval.slice(0, 4) as DatePart;
      if (date.modifier === Modifier.TEXTONLY) return date.text;
      if (start[0] === 0 && start[1] === 0 && start[2] === 0) return "";
      if (date.modifier === Modifier.SPAN) {
        return `${qualStr}${hebrewPrefix(part(start, date.calendar), "מ")} עד ${part(date.dateval.slice(4, 8) as DatePart, date.calendar)}${scal}`;
      }
      if (date.modifier === Modifier.RANGE) {
        return `${qualStr}בין ${part(start, date.calendar)} ${hebrewPrefix(part(date.dateval.slice(4, 8) as DatePart, date.calendar), "ל")}${scal}`;
      }
      const text = part(start, date.calendar);
      if (date.modifier === Modifier.NONE) {
        return `${qualStr}${start[0] === 0 || date.quality !== Quality.NONE ? hebrewPrefix(text, "ב") : text}${scal}`;
      }
      const term = locale.modifierStrings[date.modifier] ?? "";
      return `${qualStr}${term.endsWith(" ") ? term + text : hebrewPrefix(text, term)}${scal}`;
    },
  },
  // DateDisplayDE (_date_de.py): "Tag. Monat Jahr" with a dot after the
  // day, a numeric format keeping a zero day ("0.3.1854"), and format 6,
  // numeric with leading zeros. Also de_AT. The year is unsigned: Gramps
  // writes "4.11.-90 v. u. Z.", which doesn't read back (fixed).
  de: {
    gregorianLayouts: [
      ISO,
      { kind: "numeric", pad: false, isoWhenBce: false, absYear: true },
      own("long", "{long_month} {day}, {year}"),
      own("short", "{short_month} {day}, {year}"),
      own("long", "{day}. {long_month} {year}"),
      own("short", "{day}. {short_month} {year}"),
      { kind: "numeric", pad: true, isoWhenBce: false, absYear: true },
    ],
    formatIndex: IDENTITY_FORMAT_INDEX,
  },
  // DateDisplayFR (_date_fr.py): nine formats -- day-first with and without
  // a dot after the day, month-first at 6/7, and numeric ones that fall back
  // to ISO for BCE and dual (slash) years.
  fr: {
    gregorianLayouts: [
      ISO,
      { kind: "numeric", pad: false, isoWhenBce: true },
      own("long", "{day} {long_month} {year}"),
      own("short", "{day} {short_month} {year}"),
      own("long", "{day}. {long_month} {year}"),
      own("short", "{day}. {short_month} {year}"),
      own("long", "{long_month} {day}, {year}"),
      own("short", "{short_month} {day}, {year}"),
      { kind: "numeric", pad: true, isoWhenBce: true },
    ],
    formatIndex: {
      [DateFormat.ISO]: 0,
      [DateFormat.NUMERIC]: 1,
      [DateFormat.LONG_MONTH_DAY_YEAR]: 6,
      [DateFormat.SHORT_MONTH_DAY_YEAR]: 7,
      [DateFormat.DAY_LONG_MONTH_YEAR]: 2,
      [DateFormat.DAY_SHORT_MONTH_YEAR]: 3,
    },
  },
};

/** Codes with generated strings, e.g. "de", "de_AT", "pt_BR". */
export function availableLocaleCodes(): string[] {
  // English is built in (locale.ts registers it); the rest load on demand.
  return ["en", ...Object.keys(LOCALE_LOADERS)];
}

/** Loads and builds one language (null if there's no such language). A
 * regional code ("de_AT") uses its own strings and its base language's
 * layouts. */
export async function buildLocale(code: string): Promise<DateLocale | null> {
  const loader = LOCALE_LOADERS[code];
  if (!loader) return null;
  const { strings } = await loader();
  // null: the language's own base layouts, from its translated templates.
  const layout = CUSTOM_LAYOUTS[code] ?? CUSTOM_LAYOUTS[code.split("_")[0]] ?? null;
  if (typeof layout?.gregorianLayouts === "function") {
    const base = fromGramps(strings, null).baseLayouts;
    return fromGramps(strings, { ...layout, gregorianLayouts: layout.gregorianLayouts(base) });
  }
  return fromGramps(strings, layout as Parameters<typeof fromGramps>[1]);
}
