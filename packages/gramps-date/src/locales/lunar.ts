// A language's own way of writing a lunisolar date: _display_chinese_lunar in
// _date_zh_CN.py / _date_zh_TW.py, _display_korean_lunar in _date_ko.py and
// _display_vietnamese_lunar in _date_vi.py. Original: Gramps, GPL v2 or later.
//
//   zh  2024年正月1日      2020年闰四月1日      2024甲辰年正月1日 (format 2)
//   ko  2024년 정월 1일    2020년 윤사월 1일    2024 갑진년 정월 1일
//   vi  Năm 2024 Tháng Giêng Ngày 1 (a leap month: ISO)   Năm 2024 Giáp Thìn ...
//
// Format 0 is ISO; format 2 adds the year's name in the 60-year cycle.

import { Calendar, type DatePart } from "../types";

export interface LunarStyle {
  /** The calendar this applies to (the language's own). */
  calendar: Calendar;
  /** The year as written: "2024年", "2024년", "Năm 2024". */
  year: (year: string) => string;
  /** Between the year and the month, and before the day ("" for zh). */
  space: string;
  /** Leap-month prefix: 闰, 閏, 윤 ("" where leap months show as ISO). */
  leap: string;
  /** The day as written: "1日", "1일", "Ngày 1". */
  day: (day: number) => string;
  /** The year's name in the 60-year cycle (format 2, after the number). */
  cycleYear: (year: number) => string;
  /** Between the year number and its cycle name: "" (zh), " " (ko, vi). */
  cycleSpace: string;
  /** A cycle name, for reading format 2 back. */
  cyclePattern: string;
  /** Leap months as ISO in every format (Vietnamese). */
  isoForLeap?: boolean;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

function cycle(stems: readonly string[], branches: readonly string[], joiner: string) {
  return (year: number) => stems[mod(year - 4, 10)] + joiner + branches[mod(year - 4, 12)];
}

function cyclePattern(stems: readonly string[], branches: readonly string[], joiner: string): string {
  return `(?:${stems.join("|")})${joiner ? "\\s+" : ""}(?:${branches.join("|")})`;
}

const ZH_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const ZH_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const KO_STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const KO_BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const VI_STEMS = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"];
const VI_BRANCHES = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];

/** gcalendar.chinese_sexagenary_year: 1984 -> 甲子, 2024 -> 甲辰. */
export const chineseSexagenaryYear = cycle(ZH_STEMS, ZH_BRANCHES, "");

/** gcalendar.korean_ganji_year: 1984 -> 갑자, 2024 -> 갑진. */
export const koreanGanjiYear = cycle(KO_STEMS, KO_BRANCHES, "");

/** gcalendar.vietnamese_can_chi_year: 1984 -> Giáp Tý, 2024 -> Giáp Thìn. */
export const vietnameseCanChiYear = cycle(VI_STEMS, VI_BRANCHES, " ");

export const zhLunarStyle = (leap: string): LunarStyle => ({
  calendar: Calendar.CHINESE_LUNAR,
  year: (y) => `${y}年`,
  space: "",
  leap,
  day: (d) => `${d}日`,
  cycleYear: chineseSexagenaryYear,
  cycleSpace: "",
  cyclePattern: cyclePattern(ZH_STEMS, ZH_BRANCHES, ""),
});

export const KO_LUNAR_STYLE: LunarStyle = {
  calendar: Calendar.KOREAN_LUNAR,
  year: (y) => `${y}년`,
  space: " ",
  leap: "윤",
  day: (d) => `${d}일`,
  cycleYear: koreanGanjiYear,
  cycleSpace: " ",
  cyclePattern: cyclePattern(KO_STEMS, KO_BRANCHES, ""),
};

export const VI_LUNAR_STYLE: LunarStyle = {
  calendar: Calendar.VIETNAMESE_LUNAR,
  year: (y) => `Năm ${y}`,
  space: " ",
  leap: "Nhuận ",
  day: (d) => `Ngày ${d}`,
  cycleYear: vietnameseCanChiYear,
  cycleSpace: " ",
  cyclePattern: cyclePattern(VI_STEMS, VI_BRANCHES, " "),
  isoForLeap: true,
};

/** The date part in the language's own form, or null for ISO (format 0,
 * or a Vietnamese leap month). `months`: the calendar's month names. */
export function lunarText(style: LunarStyle, datePart: DatePart, index: number, months: readonly string[]): string | null {
  const [day, month, year] = datePart;
  const isLeap = month > 100;
  if (index === 0 || (isLeap && style.isoForLeap)) return null;
  const actual = isLeap ? month - 100 : month;
  const yearText = style.year(index === 2 ? `${year}${style.cycleSpace}${style.cycleYear(year)}` : String(year));
  const monthText = (isLeap ? style.leap : "") + (actual ? months[actual] : "");
  if (actual === 0 && day === 0) return yearText;
  if (day === 0) return yearText + style.space + monthText;
  return yearText + style.space + monthText + style.space + style.day(day);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reads lunarText's forms back: [day, month, year], month 101-112 for a
 * leap month; a cycle name after the year number is accepted. */
export function parseLunarText(style: LunarStyle, text: string, months: readonly string[]): DatePart | null {
  const names = months.map((name, i) => [name, i] as const).filter(([name, i]) => i > 0 && name);
  const alternation = [...names].sort((a, b) => b[0].length - a[0].length).map(([name]) => escape(name)).join("|");
  const [yearBefore, yearAfter] = style.year("\u0000").split("\u0000").map(escape);
  const [dayBefore, dayAfter] = style.day(0).split("0").map(escape);
  const sp = style.space ? "\\s*" : "";
  const leap = style.leap ? `(${escape(style.leap.trim())}\\s*)?` : "()";
  const re = new RegExp(
    `^${yearBefore}(\\d+)(?:\\s*${style.cyclePattern})?${yearAfter}(?:${sp}${leap}(${alternation})(?:${sp}${dayBefore}(\\d+)${dayAfter})?)?$`,
    "i",
  );
  const m = re.exec(text.trim());
  if (!m) return null;
  const monthIndex = m[3] ? names.find(([name]) => name.toLowerCase() === m[3].toLowerCase())?.[1] ?? 0 : 0;
  const month = monthIndex && m[2] ? monthIndex + 100 : monthIndex;
  return [m[4] ? Number(m[4]) : 0, month, Number(m[1]), false];
}
