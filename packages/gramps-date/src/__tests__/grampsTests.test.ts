// Gramps' own unit-test date sets, run against this port: the dates
// gen/lib/test/date_test.py (ParserDateTest, SwedishDateTest) and
// gen/datehandler/test/datehandler_test.py (DateHandlerTest) build,
// captured from those modules by scripts/generate_gramps_locales.py along
// with what real Gramps displays and parses for each, per language
// (fixtures/gramps-tests-<lang>.json). Gramps' tests assert display ->
// parse round-trips; here the port must produce exactly Gramps' display,
// exactly Gramps' parse of it, and the same sort value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatDate } from "../display";
import { parseDate } from "../parse";
import { makeDate } from "../entry";
import type { DatePart, GrampsDate } from "../types";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// [modifier, quality, calendar, dateval, newyear, text, sortval]
type Compact = [number, number, number, (number | boolean)[], number | [number, number], string, number];
type Shown = string | [string, Compact];

interface TestSet {
  name: string;
  formats: number[];
  dates: [Compact, Shown[]][];
}

function toDate([modifier, quality, calendar, dateval, newyear, text, sortval]: Compact): GrampsDate {
  return { modifier, quality, calendar, dateval, newyear, text, sortval } as unknown as GrampsDate;
}

/** The parts parsing decides (text only matters for a text-only date). */
function structured(d: { modifier: number; quality: number; calendar: number; dateval: unknown; newyear: unknown; text: string }) {
  return JSON.stringify([d.modifier, d.quality, d.calendar, d.dateval, d.newyear, d.modifier === 6 ? d.text : ""]);
}

const MAX_REPORTED = Number(process.env.MAX_REPORTED ?? 15);

for (const file of readdirSync(FIXTURES).filter((f) => f.startsWith("gramps-tests-"))) {
  const { lang, sets } = JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as { lang: string; sets: TestSet[] };

  for (const set of sets) {
    test(`${lang}: Gramps ${set.name} (${set.dates.length} dates x ${set.formats.length} formats)`, () => {
      const bad: string[] = [];
      for (const [compact, shown] of set.dates) {
        const date = toDate(compact);

        if (date.modifier !== 6) {
          const compound = date.modifier === 4 || date.modifier === 5;
          const rebuilt = makeDate({
            modifier: date.modifier,
            quality: date.quality,
            calendar: date.calendar,
            newyear: date.newyear,
            start: date.dateval.slice(0, 4) as DatePart,
            stop: compound ? (date.dateval.slice(4, 8) as DatePart) : undefined,
          });
          if (rebuilt.sortval !== date.sortval) bad.push(`sortval ${JSON.stringify(compact)}: got ${rebuilt.sortval}`);
        }

        set.formats.forEach((index, i) => {
          const entry = shown[i];
          const text = typeof entry === "string" ? entry : entry[0];
          const want = typeof entry === "string" ? structured(date) : structured(toDate(entry[1]));
          const display = formatDate(date, { locale: lang, grampsFormat: index });
          if (display !== text) bad.push(`#${index} display ${JSON.stringify(compact)}: got ${JSON.stringify(display)} want ${JSON.stringify(text)}`);
          const parsed = structured(parseDate(text, { locale: lang }));
          if (parsed !== want) bad.push(`#${index} parse ${JSON.stringify(text)}: got ${parsed} want ${want}`);
        });
      }
      assert.deepEqual(bad.slice(0, MAX_REPORTED), [], `${bad.length} mismatches`);
    });
  }
}
