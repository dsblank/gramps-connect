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
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatDate } from "../display";
import { parseDate } from "../parse";
import { loadLocale } from "../locale";
import { makeDate, validateDate } from "../entry";
import type { DatePart, GrampsDate } from "../types";
import { knownGrampsBug } from "./knownGrampsBugs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// [modifier, quality, calendar, dateval, newyear, text, sortval]
type Compact = [number, number, number, (number | boolean)[], number | [number, number], string, number];
// null where Gramps itself raised displaying the date (generator's
// gramps_display) -- nothing to compare against.
type Shown = string | [string, Compact | null] | null;

interface TestSet {
  name: string;
  formats: number[];
  dates: [Compact, Shown[]][];
}

function toDate([modifier, quality, calendar, dateval, newyear, text, sortval]: Compact): GrampsDate {
  return { modifier, quality, calendar, dateval, newyear, text, sortval } as unknown as GrampsDate;
}

/** The parts parsing decides (text only matters for a text-only date). */
/** The parts parsing decides. A text-only date is just its text (shown
 * as nothing else, so quality etc. can't round-trip -- Gramps' is_equal
 * compares only the text there too). */
function structured(d: { modifier: number; quality: number; calendar: number; dateval: unknown; newyear: unknown; text: string }) {
  if (d.modifier === 6) return JSON.stringify([6, d.text]);
  return JSON.stringify([d.modifier, d.quality, d.calendar, d.dateval, d.newyear, ""]);
}

const MAX_REPORTED = Number(process.env.MAX_REPORTED ?? 15);

for (const file of readdirSync(FIXTURES).filter((f) => f.startsWith("gramps-tests-") && f.endsWith(".json.gz"))) {
  const { lang, sets } = JSON.parse(gunzipSync(readFileSync(join(FIXTURES, file))).toString("utf8")) as { lang: string; sets: TestSet[] };

  for (const set of sets) {
    test(`${lang}: Gramps ${set.name} (${set.dates.length} dates x ${set.formats.length} formats)`, async () => {
    // English is built in; every other language loads on demand.
    assert.ok(await loadLocale(lang), `no gramps-date locale for ${lang}`);
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

        // A date that isn't valid in its own calendar (e.g. 1 March 1712 in
        // the Swedish one) can't round-trip anywhere -- display only.
        const valid = date.modifier === 6 || validateDate(date).valid;

        set.formats.forEach((index, i) => {
          const entry = shown[i];
          const display = formatDate(date, { locale: lang, grampsFormat: index });
          // Gramps' own output is the reference where it reads back as the
          // same date (a plain string entry). Where it doesn't -- or Gramps
          // raised (null) -- that's a Gramps bug: ours may differ.
          if (typeof entry === "string" && display !== entry && !knownGrampsBug({ lang, index, modifier: date.modifier, ours: display, gramps: entry })) {
            bad.push(`#${index} display ${JSON.stringify(compact)}: got ${JSON.stringify(display)} want ${JSON.stringify(entry)}`);
          }
          // Ours must always read back as the same date (Gramps' own
          // DateHandlerTest invariant).
          if (valid) {
            const back = structured(parseDate(display, { locale: lang, grampsFormat: index }));
            if (back !== structured(date)) bad.push(`#${index} round-trip ${JSON.stringify(display)}: got ${back} want ${structured(date)}`);
          }
        });
      }
      assert.deepEqual(bad.slice(0, MAX_REPORTED), [], `${bad.length} mismatches`);
    });
  }
}
