// A Gramps Date as Extended Date/Time Format (ISO 8601-2) -- the
// machine-readable form a downloaded story carries next to each date's
// display text (spec/1.0 section 3.2 in gramps-connect-stories). Only what
// maps faithfully: a Gregorian date with a real year. Anything else (other
// calendars, dual-dated years, a non-default new-year start, text-only
// dates, an unknown year) gets no EDTF at all, which the format allows,
// rather than a plausible-looking wrong one.
import {
  Calendar, getStartDate, getStopDate, Modifier, Quality,
  type DatePart, type GrampsDate,
} from "@gramps-connect/gramps-date";

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** "1850", "1850-03", "1850-03-12"; null for a part with no usable year
 * (Gramps' 0 means unknown) or one EDTF can't write without its
 * extended-year syntax. */
function formatPart([day, month, year, slash]: DatePart): string | null {
  if (slash || year <= 0 || year > 9999) return null;
  if (month < 1 || month > 12) return pad(year, 4);
  if (day < 1) return `${pad(year, 4)}-${pad(month, 2)}`;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function toEdtf(date: GrampsDate | null | undefined): string | undefined {
  if (!date || date.calendar !== Calendar.GREGORIAN) return undefined;
  if (date.newyear !== 0) return undefined;
  if (date.modifier === Modifier.TEXTONLY) return undefined;
  const start = formatPart(getStartDate(date));
  if (!start) return undefined;
  // "about", "estimated" and "calculated" all say the same thing EDTF's
  // approximate marker does: near this, not exactly this.
  const q = date.quality !== Quality.NONE || date.modifier === Modifier.ABOUT ? "~" : "";

  switch (date.modifier) {
    case Modifier.NONE:
    case Modifier.ABOUT:
      return `${start}${q}`;
    case Modifier.BEFORE:
    case Modifier.TO:
      return `../${start}${q}`;
    case Modifier.AFTER:
    case Modifier.FROM:
      return `${start}${q}/..`;
    case Modifier.RANGE:
    case Modifier.SPAN: {
      const stop = formatPart(getStopDate(date));
      if (!stop) return undefined;
      // "between A and B" is one date somewhere in there (an EDTF set,
      // "one of"); "from A to B" is the whole interval.
      return date.modifier === Modifier.RANGE ? `[${start}${q}..${stop}${q}]` : `${start}${q}/${stop}${q}`;
    }
    default:
      return undefined;
  }
}
