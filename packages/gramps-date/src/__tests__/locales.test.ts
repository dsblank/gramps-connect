// Every shipped locale against what real Gramps displays and parses, with
// Gramps' bugs fixed rather than copied (see the tests below) --
// fixtures/gramps-<lang>.json, written by scripts/generate_gramps_locales.py
// from Gramps' own DateDisplay/DateParser. Every one of the language's
// numbered formats is checked, not just the six DateFormat maps to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatDate } from "../display";
import { parseDate } from "../parse";
import { loadLocale } from "../locale";
import type { GrampsDate } from "../types";
import { validateDate } from "../entry";
import { knownGrampsBug } from "./knownGrampsBugs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

interface Fixture {
  lang: string;
  formatNames: string[];
  // null where Gramps itself raised displaying the date (generator's
  // gramps_display) -- nothing to compare against.
  vectors: { date: GrampsDate; formats: ({ text: string; parsed: GrampsDate | null; grampsRoundTrips: boolean } | null)[] }[];
  // parsed null: Gramps' parser itself raised on this text (skipped).
  typed: { text: string; parsed: GrampsDate | null }[];
}

/** The parts parsing decides. A text-only date is just its text (shown
 * as nothing else, so quality etc. can't round-trip -- Gramps' is_equal
 * compares only the text there too). */
const structured = (d: GrampsDate) =>
  d.modifier === 6
    ? { modifier: 6, text: d.text }
    : { modifier: d.modifier, quality: d.quality, calendar: d.calendar, dateval: d.dateval, newyear: d.newyear, text: "" };

for (const file of readdirSync(FIXTURES).filter((f) => f.startsWith("gramps-") && !f.startsWith("gramps-tests-") && f.endsWith(".json.gz"))) {
  const fixture: Fixture = JSON.parse(gunzipSync(readFileSync(join(FIXTURES, file))).toString("utf8"));
  const { lang } = fixture;

  test(`${lang}: display matches Gramps where Gramps is right, and always reads back`, async () => {
    // English is built in; every other language loads on demand.
    assert.ok(await loadLocale(lang), `no gramps-date locale for ${lang}`);
    const bad: string[] = [];
    for (const { date, formats } of fixture.vectors) {
      const valid = date.modifier === 6 || validateDate(date).valid;
      formats.forEach((entry, index) => {
        const got = formatDate(date, { locale: lang, grampsFormat: index });
        // Gramps' text is the reference only where Gramps reads it back as
        // the same date; otherwise (or where Gramps raised) it's a Gramps bug.
        if (entry?.grampsRoundTrips && got !== entry.text && !knownGrampsBug({ lang, index, modifier: date.modifier, ours: got, gramps: entry.text })) {
          bad.push(`#${index} ${JSON.stringify(date.dateval)} m${date.modifier} c${date.calendar}: got ${JSON.stringify(got)} want ${JSON.stringify(entry.text)}`);
        }
        if (valid) {
          const back = structured(parseDate(got, { locale: lang, grampsFormat: index }));
          if (JSON.stringify(back) !== JSON.stringify(structured(date))) bad.push(`#${index} round-trip ${JSON.stringify(got)}: got ${JSON.stringify(back)}`);
        }
      });
    }
    assert.deepEqual(bad, []);
  });

  test(`${lang}: parsing typed input gives what Gramps' parser gives`, async () => {
    // English is built in; every other language loads on demand.
    assert.ok(await loadLocale(lang), `no gramps-date locale for ${lang}`);
    const bad = fixture.typed
      // Where Gramps reads the input as a real date, so must we; where it
      // gives up (text-only) or raises, we're free to do better.
      .filter((entry): entry is { text: string; parsed: GrampsDate } => entry.parsed !== null && entry.parsed.modifier !== 6)
      .map(({ text, parsed }) => ({ text, got: structured(parseDate(text, { locale: lang })), want: structured(parsed) }))
      .filter(({ got, want }) => JSON.stringify(got) !== JSON.stringify(want))
      .map(({ text, got, want }) => `${JSON.stringify(text)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    assert.deepEqual(bad, []);
  });
}
