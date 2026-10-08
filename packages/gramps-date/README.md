# @gramps-connect/gramps-date

A TypeScript port of Gramps' `Date` model, calendar conversion, and
locale-aware date display -- for clients that receive a raw Gramps `Date`
struct from `gramps-web-api` (e.g. a `{"json_path": [..., "date"]}` select
entry against the fast `/query/` endpoints) and need to render or build one
without a per-object round trip through Gramps' own Python date displayer,
which would defeat the point of using the fast endpoints in the first
place. `gramps-web` (the other Gramps frontend) sidesteps this entirely by
always fetching a pre-formatted date string from a slower, per-object
"profile" endpoint; this package exists because `gramps-connect`
deliberately doesn't use that endpoint for bulk data.

## What's here

- **`types.ts`** -- the wire-format `GrampsDate` struct and `Modifier`/
  `Quality`/`Calendar`/`NewYear` enums.
- **`calendar.ts`** -- SDN (Serial/Julian Day Number) conversion for all
  ten Gramps calendars, and calendar-aware date validation. That includes
  the lunisolar calendars of Gramps 6.2 -- Chinese, Korean and Vietnamese
  Lunar, whose months 101-112 are leap months -- over their year tables
  (`lunarTables.generated.ts`, from Gramps' `lunartables.py`). Korea's and
  Vietnam's calendars are computed for their own meridians, so they have
  their own tables where they differ from China's.
- **`display.ts`** -- `formatDate(date, options)`: Gramps' `DateDisplay`,
  in every format of every language Gramps has (43, from `po/LINGUAS` plus
  English): modifiers, quality, compound dates, calendar and new-year
  suffixes, B.C.E., grammatical month forms (Czech, Finnish, Croatian,
  Russian, Slovak, Slovenian, Ukrainian), and each lunisolar calendar in
  its own language's form (`locales/lunar.ts`: "2024年正月1日",
  "2024년 정월 1일", "Năm 2024 Tháng Giêng Ngày 1").
- **`parse.ts`** -- `parseDate(text, options)`: Gramps' `DateParser`, so
  what a user types ("before 1960", "abt Mar 1854 (Julian)") becomes a
  structured date, and every displayed date reads back.
- **`entry.ts`** -- `makeDate(input)` builds a `GrampsDate` from
  structured components; `validateDate(date)` checks it.
- **`locale.ts`**, **`locales/`** -- the `DateLocale` interface and the
  languages. English is built in; the others load on demand
  (`loadLocale(code)`, `availableLocales()`, `resolveLocaleCode(code)`),
  each its own bundle chunk. Their strings are generated from a live
  Gramps (`locales/<code>.generated.ts`); the languages whose displayer
  lays dates out its own way have hand-written layouts in
  `locales/index.ts`.

## Keeping up with Gramps

`scripts/generate_gramps_locales.py` regenerates every language's strings,
the lunar year tables and the test fixtures from a Gramps (about 4 seconds,
one process per language). Run it after a Gramps update, then `npm test`.
The tests check every format of every language against what Gramps itself
displays, against the date sets of Gramps' own unit tests, and that every
displayed date parses back.

It needs a Gramps with the lunisolar calendars: 6.2, or until then a
checkout of the lunar-calendar pull requests (gramps-project/gramps#2374,
which builds on #2375 and #2369), with its translations compiled:

```sh
GRAMPS=~/src/gramps-lunar            # the checkout
RES=$(mktemp -d)                     # its resources: data + compiled catalogs
ln -s $GRAMPS/data $RES/gramps
for lang in $(grep -v '^#' $GRAMPS/po/LINGUAS); do
  mkdir -p $RES/locale/$lang/LC_MESSAGES
  msgfmt -o $RES/locale/$lang/LC_MESSAGES/gramps.mo $GRAMPS/po/$lang.po
done
PYTHONPATH=$GRAMPS GRAMPS_RESOURCES=$RES python3 scripts/generate_gramps_locales.py
```

Where Gramps is wrong -- a displayed date that doesn't read back, a crash,
lost input -- gramps-date does the right thing instead, and the case is
recorded in [GRAMPS_BUGS.md](GRAMPS_BUGS.md) for reporting upstream
(`src/__tests__/knownGrampsBugs.ts` lists the ones whose Gramps text still
reads back, so the tests accept ours there).

## Provenance and license

This package is a translation of Gramps core's own date model and
display logic (`gramps/gen/lib/date.py`, `gramps/gen/lib/gcalendar.py`,
`gramps/gen/datehandler/_datedisplay.py`, `_datestrings.py`) from Python
to TypeScript, plus `calendar.ts`'s validation helpers, which follow the
same approach `gramps-web`'s own `src/gcalendar.js` (a prior JS port of
the same Python module) already established. Original copyright holders
are credited in each file's header, alongside the GPL-2.0-or-later
license the original Python source itself carries.

`gramps-connect` as a whole (including this package) is distributed
under AGPL-3.0-or-later, matching `gramps-web-api` and `gramps-web` --
GPL-2.0-or-later's "or any later version" clause plus GPLv3/AGPLv3's own
mutual-compatibility provisions permit combining GPL-2.0-or-later code
into a larger AGPL-3.0-or-later work, the same way `gramps-web` itself
already does for its own `gcalendar.js` port (one repo-wide AGPL-3.0
LICENSE, despite incorporating GPL-2.0-or-later-derived logic).
