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
- **`calendar.ts`** -- SDN (Serial/Julian Day Number) conversion for five
  calendars (Gregorian, Julian, French Republican, Islamic, Swedish) plus
  round-trip date validation. Hebrew and Persian aren't implemented (their
  SDN conversion needs more machinery); dates in those calendars still
  display correctly, they just can't be validated on entry.
- **`display.ts`** -- `formatDate(date, options)`: modifiers ("before
  1960", "about Nov 1914"), quality ("estimated "/"calculated "),
  compound dates ("between X and Y", "from X to Y"), non-Gregorian
  calendar and non-Jan-1-new-year suffixes, B.C.E., six display formats
  (ISO, numeric, long/short month with day-then-month or month-then-day
  ordering).
- **`entry.ts`** -- `makeDate(input)` builds a `GrampsDate` from
  structured components (day/month/year/modifier/quality/calendar, not
  free text); `validateDate(date)` checks it (calendar-valid, and for a
  range/span, that the second date is later than the first).
- **`locale.ts`** / **`locales/en.ts`** -- a locale-plugin interface
  (`DateLocale`) plus one implementation. Only English ships today;
  adding a language means writing a new `locales/<code>.ts` and calling
  `registerLocale()`, no changes to `display.ts` itself.

## What's deliberately not here (yet)

- **Free-text date parsing** (typing "before 1960" and having it turn
  into a structured `Date`) -- that's `gramps/gen/datehandler/
  _dateparser.py`, a large regex-based grammar, a separate undertaking
  from structured entry.
- **Grammatical inflection** (`_datedisplay.py`'s `Lexeme`/
  `FORMATS_long_month_year` machinery) -- only matters for languages
  with case-marked month names (Russian and similar); doesn't affect
  English, which is the only locale implemented so far.
- **Hebrew/Persian calendar math** -- see calendar.ts's note above.

Add these the same way everything else here was built: read the
corresponding Python source in `gramps/gen/`, translate it, verify
against the real thing (this package's own tests cross-check every case
against a live `DateDisplayEn`/`gcalendar.py` run, not just hand-derived
expected values).

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
