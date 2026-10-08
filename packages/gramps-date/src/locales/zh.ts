// Chinese date layouts and wording: DateDisplayZH_CN / DateDisplayZH_TW and
// their parsers' additions (_date_zh_CN.py, _date_zh_TW.py; zh_HK uses the
// Traditional ones). Original: Gramps, GPL v2 or later.
//
// Every calendar is shown numerically ("1854年3月12日") or as ISO; the wording
// around a date is the displayer's own, not translated: postfix 以前/以后,
// and a quality fused with "before"/"after" ("估计早于").

import { Modifier, Quality, type DatePart, type GrampsDate } from "../types";
import type { DateLocale, DisplayHelpers } from "../locale";
import { zhLunarStyle } from "./lunar";

interface ZhWords {
  estimated: string; // 估计为
  calculated: string; // 推算为
  estimatedBefore: string; // 估计早于
  estimatedAfter: string; // 估计晚于
  calculatedBefore: string; // 推算早于
  calculatedAfter: string; // 推算晚于
  before: string; // 以前 (after the date)
  after: string; // 以后 (after the date)
  about: string; // 大约
  from: string; // 从
  to: string; // 到
  spanFrom: string; // 自
  spanTo: string; // 至
  rangeStart: string; // 介于
  rangeAnd: string; // 与
  rangeEnd: string; // 之间
  leap: string; // 闰
}

export const ZH_CN_WORDS: ZhWords = {
  estimated: "估计为", calculated: "推算为",
  estimatedBefore: "估计早于", estimatedAfter: "估计晚于", calculatedBefore: "推算早于", calculatedAfter: "推算晚于",
  before: "以前", after: "以后", about: "大约", from: "从", to: "到",
  spanFrom: "自", spanTo: "至", rangeStart: "介于", rangeAnd: "与", rangeEnd: "之间", leap: "闰",
};

export const ZH_TW_WORDS: ZhWords = {
  estimated: "估計為", calculated: "推算為",
  estimatedBefore: "估計早於", estimatedAfter: "估計晚於", calculatedBefore: "推算早於", calculatedAfter: "推算晚於",
  before: "以前", after: "以後", about: "大約", from: "從", to: "到",
  spanFrom: "自", spanTo: "至", rangeStart: "介於", rangeAnd: "與", rangeEnd: "之間", leap: "閏",
};

/** DateDisplayZH_CN.display_formatted / dd_span / dd_range. */
function zhDisplay(words: ZhWords): NonNullable<DateLocale["display"]> {
  return (date: GrampsDate, helpers: DisplayHelpers) => {
    // Chinese lunar dates come out the zh way through the locale's lunarStyle.
    const part = (datePart: DatePart) => helpers.part(datePart, date.calendar);
    const scal = helpers.extras(date.calendar, date.newyear);
    const qual = date.quality === Quality.ESTIMATED ? words.estimated : date.quality === Quality.CALCULATED ? words.calculated : "";
    const start = part(date.dateval.slice(0, 4) as unknown as DatePart);
    if (date.modifier === Modifier.SPAN || date.modifier === Modifier.RANGE) {
      const stop = part(date.dateval.slice(4, 8) as unknown as DatePart);
      return date.modifier === Modifier.SPAN
        ? `${qual}${words.spanFrom}${start}${words.spanTo}${stop}${scal}`
        : `${qual}${words.rangeStart}${start}${words.rangeAnd}${stop}${words.rangeEnd}${scal}`;
    }
    if (date.modifier === Modifier.BEFORE || date.modifier === Modifier.AFTER) {
      const before = date.modifier === Modifier.BEFORE;
      if (date.quality === Quality.ESTIMATED) return `${before ? words.estimatedBefore : words.estimatedAfter}${start}${scal}`;
      if (date.quality === Quality.CALCULATED) return `${before ? words.calculatedBefore : words.calculatedAfter}${start}${scal}`;
      return `${start}${before ? words.before : words.after}${scal}`;
    }
    const mod = date.modifier === Modifier.ABOUT ? words.about : date.modifier === Modifier.FROM ? words.from : date.modifier === Modifier.TO ? words.to : "";
    return `${qual}${mod}${start}${scal}`;
  };
}

const ISO = { kind: "iso" } as const;
const NUMERIC = { kind: "baseNumeric" } as const;

/** The zh layout for CUSTOM_LAYOUTS: ISO, then the numeric 年月日 format
 * for every other format and calendar ("干支年格式" differs only for
 * Chinese lunar dates). */
export function zhLayout(words: ZhWords) {
  return {
    layoutsForAllCalendars: true,
    gregorianLayouts: [ISO, NUMERIC, NUMERIC],
    // The six shared formats: ISO, then numeric for the rest.
    formatIndex: { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
    display: zhDisplay(words),
    lunarStyle: zhLunarStyle(words.leap),
    compoundQualityModifiers: {
      [words.estimatedBefore]: [Quality.ESTIMATED, Modifier.BEFORE],
      [words.estimatedAfter]: [Quality.ESTIMATED, Modifier.AFTER],
      [words.calculatedBefore]: [Quality.CALCULATED, Modifier.BEFORE],
      [words.calculatedAfter]: [Quality.CALCULATED, Modifier.AFTER],
    } as DateLocale["compoundQualityModifiers"],
  };
}
