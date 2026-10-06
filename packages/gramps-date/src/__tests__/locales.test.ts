// Every shipped locale against what real Gramps displays and parses --
// fixtures/gramps-<lang>.json, written by scripts/generate_gramps_locales.py
// from Gramps' own DateDisplay/DateParser. Every one of the language's
// numbered formats is checked, not just the six DateFormat maps to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatDate } from "../display";
import { parseDate } from "../parse";
import type { GrampsDate } from "../types";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

interface Fixture {
  lang: string;
  formatNames: string[];
  vectors: { date: GrampsDate; formats: { text: string; parsed: GrampsDate; grampsRoundTrips: boolean }[] }[];
  typed: { text: string; parsed: GrampsDate }[];
}

const structured = (d: GrampsDate) => ({
  modifier: d.modifier,
  quality: d.quality,
  calendar: d.calendar,
  dateval: d.dateval,
  newyear: d.newyear,
  text: d.modifier === 6 ? d.text : "",
});

for (const file of readdirSync(FIXTURES).filter((f) => f.startsWith("gramps-") && !f.startsWith("gramps-tests-"))) {
  const fixture: Fixture = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
  const { lang } = fixture;

  test(`${lang}: display matches Gramps in all ${fixture.formatNames.length} formats`, () => {
    const bad: string[] = [];
    for (const { date, formats } of fixture.vectors) {
      formats.forEach(({ text }, index) => {
        const got = formatDate(date, { locale: lang, grampsFormat: index });
        if (got !== text) bad.push(`#${index} ${JSON.stringify(date.dateval)} m${date.modifier} c${date.calendar}: got ${JSON.stringify(got)} want ${JSON.stringify(text)}`);
      });
    }
    assert.deepEqual(bad, []);
  });

  test(`${lang}: parsing Gramps' output gives what Gramps' parser gives`, () => {
    const bad: string[] = [];
    for (const { formats } of fixture.vectors) {
      for (const { text, parsed } of formats) {
        const got = structured(parseDate(text, { locale: lang }));
        const want = structured(parsed);
        if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${JSON.stringify(text)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test(`${lang}: parsing typed input gives what Gramps' parser gives`, () => {
    const bad = fixture.typed
      .map(({ text, parsed }) => ({ text, got: structured(parseDate(text, { locale: lang })), want: structured(parsed) }))
      .filter(({ got, want }) => JSON.stringify(got) !== JSON.stringify(want))
      .map(({ text, got, want }) => `${JSON.stringify(text)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    assert.deepEqual(bad, []);
  });
}
