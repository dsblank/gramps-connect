# Per-tree display settings + "Import from Gramps desktop" — implementation plan

Client-side only: no gramps-web-api changes (per the project's default of
composing existing endpoints). gramps-connect formats dates, places, and
(via request args) names from settings it owns, stored per tree, and can
seed those settings from a user's desktop `gramps.ini` / `place_formats.xml`.

## Decisions (approved 2026-10-06)

1. **One-shot import with a preview**: per-setting checkboxes, no sync with
   the desktop files.
2. **Per tree, editable afterward**: the import only prefills the Display
   settings section, so that section and the formatters ship first.
3. **Writes need `PERM_EDIT_TREE`**: owners/editors only; everyone else
   sees the settings read-only.
4. **Reports reuse `date_format`/`name_format`; `place_format` stays
   Default**, because its index refers to the server's own
   `place_formats.xml`.

**Tab name (2026-10-06):** shipped as Administration → **Preferences**
(not "Display"), after desktop's Edit → Preferences, because planned
additions (ID prefixes, date-entry format) would affect what gets saved, not
just display. The stored key stays `display`, and the code keeps
`displaySettings.ts`/`DisplaySettingsPanel.tsx`; both are internal names.

## Problem

gramps-web-api applies Gramps-core preferences from **its own process's**
`gramps.ini` and `place_formats.xml`, with no endpoint to read or write
them (`/api/config/<key>/` only allows `DB_CONFIG_ALLOWED_KEYS`: email,
`BASE_URL`, `FRONTEND_URL`). `config` is a per-process global, and the
Docker image runs 8 gunicorn workers plus a Celery worker, so a server-side
write wouldn't even be coherent. Users therefore can't change:

- **Place format** (`preferences.place-auto`, `place-format`,
  `place_formats.xml`): applied to the event-profile `place` string
  (`util.py:525`), timelines' `place.display_name`, `?sort=place` /
  `?sort=title`, exports, reports.
- **Date format** (`preferences.date-format`): every `profile.*.date`
  string and timelines (`timeline.py:488` reads config directly; there is
  no `date_format` request arg).
- Others with less visible effect: ID prefixes, probably-alive constants,
  missing/private name placeholders.

Only `name_format` has a per-request override on the regular endpoints.

Meanwhile gramps-connect itself:
- Hardcodes `DateFormat.DAY_SHORT_MONTH_YEAR` in `store/views.ts:144`,
  `components/related/summary.ts:18`, `store/visualData.ts:198`. Three
  other `formatDate()` calls use the package default.
- Shows the server's preformatted `profile.*.date` in Tree, Fan, and Family
  Graph labels (`charts/treeChart.ts`, `charts/fanChart.ts`,
  `FamilyGraphView.tsx`, `TreeView.tsx`) and `profile.*.place` and
  `profile.*.date` in search snippets (`searchSnippet.ts`), so the two
  date formats can disagree on one screen.
- Shows places as the stored `title`, falling back to the primary name
  (`placeTitleOrName`, `store/views.ts`). The stored `title` is never
  auto-generated (desktop's place-auto hides it from the editor), so it is
  usually empty or stale. Timeline and Story use the same `title`.

## Storage

`GET/PUT /api/trees/-/config` is a free-form JSON blob in the user DB.
Reading it needs only tree membership. `PUT` replaces the **whole** blob and
needs `PERM_EDIT_TREE`. The server never reads it back. One key, versioned:

```jsonc
{
  "display": {
    "version": 1,
    "date": { "format": 5 },             // gramps-date DateFormat
    "name": { "format": "%f %l %s" },    // format STRING, sent as name_format=; "" = server default
    "place": {
      "auto": true,                      // false → show stored title (fallback: primary name)
      "active": 0,                       // index into formats
      "formats": [
        { "name": "Full", "levels": ":", "language": "", "street": 0, "reverse": false }
      ]
    }
  }
}
```

- Missing keys fall back to defaults: today's behavior, so nothing visibly
  changes for trees with no settings.
- Write by read-modify-write: GET, replace only `display`, PUT, so other
  keys in the blob survive.
- Cache in memory (and with the existing per-tree cache-meta, if
  convenient), and refetch on tree switch. Changes are rare, so no polling.
- Users without `PERM_EDIT_TREE` see the settings read-only.

## Phase 1: settings model + Display settings UI (implemented 2026-10-06)

1. `store/displaySettings.ts`: types, defaults, `fetchDisplaySettings`,
   `saveDisplaySettings` (read-modify-write), a React context or hook
   (`useDisplaySettings()`), and validation (clamp unknown indexes, drop
   malformed place formats).
2. A "Display" section in `AdministrationDialog.tsx`. Fields:
   - Date format: select with a live example ("12 Mar 1854").
   - Name format: select. Built-ins (hardcoded, mirroring
     `NameDisplay.STANDARD_FORMATS`) plus the tree's custom formats from
     `/api/name-formats/`, plus "Server default" (`""`). The setting stores
     the **format string**, not a number (see Resolved questions #3).
   - Place: "Automatic place titles" switch, active-format select, and a
     small format list editor (name, levels, language, street
     none/number-street/street-number, reverse) with a live example on a
     real place from the tree.
3. Wiki: document the new settings (the page that covers settings/
   administration, else `Overview.md`).

## Phase 2: client formatters + switching every display site (implemented 2026-10-06)

As built:
- `store/placeDisplay.ts`: pure port of `PlaceDisplay.display()` +
  `get_location_list`. **Cross-checked against real Gramps**: every place
  and every event place in `example.gramps` (plus synthetic places with
  dated alt names, dated parents, house numbers, `de` names) under 9
  formats, **30,816 comparisons, 0 mismatches**. Raw `place_type` is
  `{value: int}` from the query endpoint (REST's profile returns the
  string), so types compare as PlaceType integers.
- PLACE_VIEW gained hidden `place_type`, `alt_names`, `placerefs` (dated
  refs, unlike `enclosed_by`). That changes the schema signature, so each
  client refetches its Places cache once.
- `store/placeIndex.ts`: builds the lookup from the Places cache,
  `displayPlaceTitle(handle, date?)`, `formatDisplayDate()`,
  `useDisplayFormatVersion()`. Gets the place/event stores via
  `attachDisplayStores()` from `registry.ts`, to avoid a views→registry
  import cycle.
- `ColumnConfig.toDisplay(value, row?)`: the row accessor (sibling columns
  + `handle`, which `getRows()` now appends) lets the Places/Events title
  cells format by handle and event date.
- `store/lifeEventDates.ts`: chart and snippet dates/places from the raw
  person/family + Events cache, using gramps' get_birth/death/marriage_or_
  fallback rules; server text when the cache can't answer.
- Names: `name_format` on `fetchObjectExtended` (applies to nested
  profiles too, verified). **`/api/search/` 422s on `name_format`**
  (not in SearchQueryArgs), so search names stay server-formatted.
- Reports: `date_format` = format + 1, `name_format` = built-in number.
- Sorting: the Places table still sorts by stored `title` (rowid = server
  order, see viewStore.getRows). Displayed formatted titles can be out of
  order there.
- Not changed: `DateInput.tsx`'s edit buffer keeps its own format.

Original plan:

### Dates
- Replace the three hardcoded `DAY_SHORT_MONTH_YEAR` sites and the three
  default `formatDate()` display calls with a `formatDisplayDate(date)`
  that reads settings. `DateInput.tsx` should use the same format so that
  what you type matches what you see. Verify that `gramps-date`'s parser
  round-trips every format.
- Charts and search snippets: stop reading `profile.birth.date` /
  `profile.death.date` / `profile.marriage.date`. Get the raw event `date`
  instead: `store/treeData.ts` already fetches people with `extend=`; add
  the birth/death event refs (or a GOQL projection of
  `birth.date`/`death.date` raw JSON) and format client-side. Check payload
  size in `treeData.ts` before/after.

### Places
- `packages/gramps-date` is the precedent: port `PlaceDisplay.display()`
  (gramps `gen/display/place.py:87-145`) to TS, e.g.
  `app/src/store/placeDisplay.ts`, pure, with unit tests mirroring desktop:
  - `get_location_list(db, place, date, lang)` walks `placeref_list[0]`
    upward, picking the name valid at `date` (alt names have dates) and in
    `lang`. It needs the place's ancestor chain; get it from the local
    cache's `enclosed_by` column (`store/views.ts:477`), not per-place
    fetches.
  - `levels` slice syntax (`"1:"`, `":-1"`, `"p"` offsets relative to the
    first populated place, per `_find_populated_place`), the `street` merge
    of a NUMBER-type place with the next level, `reverse`.
  - Cycle guard (desktop has none; the data can have cycles).
- Display sites to switch: place columns (`placeTitleOrName` →
  formatter when `auto`), event place columns, Timeline
  (`visualData.ts` `placeTitle`), Story (`storyHydration.ts:69`), related
  summaries, search snippets (use `profile.place`'s handle, not its string),
  map labels. Date-aware: event places format with the event's date, as
  desktop does in `display_event`.
- GOQL `place.title` stays the stored field. Document that in the search
  help; don't try to make GOQL see formatted titles.
- Sorting: if a place column sorts by display string, the local `getRows`
  ORDER BY needs the formatted value (a computed column at cache-load
  time, or JS sort). Check both ordering codepaths (server `order_by` and
  local `getRows`), per the earlier wrong-row-highlight lesson.

### Names
- Pass `name_format=` (the format string, URL-encoded) on every request
  that reads `profile.name_display` (`treeData.ts`, `objectDetail.ts`,
  search). It only affects `name_display`; `name_given`/`name_surname`
  and anything under `extended` are unaffected. Client-built names
  (`personName()` in `summary.ts`) stay as they are unless the format is
  non-default. Possible later step: port `NameDisplay` too.

### Reports
- `ReportDialog`: prefill `date_format` and `name_format` from settings.
  Leave `place_format` at Default: its index refers to the **server's**
  `place_formats.xml`, which we can't read or compare.

## Phase 3: "Import from Gramps desktop…" (implemented 2026-10-06)

As built:
- `store/desktopSettingsImport.ts` (pure, 11 tests) + `ImportDesktopSettingsDialog.tsx`,
  opened from a button in the Display panel. It fills the panel's *draft*;
  the panel's Save writes it.
- **Change from the plan:** `;;` (default) lines are *not* skipped. They're
  shown with a "Gramps default" badge and start unticked. Reason: a real
  `gramps.ini` (the user's own) has all four relevant keys as `;;` defaults,
  so skipping them would import nothing, though desktop really does show
  ISO dates etc.
- Booleans are written as `0`/`1` (ConfigManager does `int(value)` for
  ints, and bool is an int).
- `DESKTOP_DATE_FORMATS` was hand-mapped from a dump of every
  `LANG_TO_DISPLAY` displayer's `formats` (Gramps 6.0). Day-first numerics
  map to NUMERIC (our only numeric, month-first in English); year-first /
  Roman-numeral formats → null.
- Pre-ticked rows: usable, not a default, and different from the current draft.
- `placeActive` pulls in `placeFormats` (`withDependencies`), since it indexes
  desktop's list.
- Only the 4 keys with a consumer are imported. ID prefixes, alive
  constants and name placeholders still have no client-side consumer.

Original plan:

A button in the Display section. It opens a dialog with two file inputs:

- `gramps.ini`, from `~/.config/gramps/gramps60/` (Linux),
  `%APPDATA%\gramps\gramps60\` (Windows), and
  `~/Library/Application Support/gramps/gramps60/` (macOS; verify).
- `place_formats.xml` (optional), one level up, in `USER_CONFIG` itself
  (`gen/const.py:147`), not the versioned dir. It exists only if the user
  defined custom formats.

### Parsing
- INI with `[section]` headers and `key=value`, where values are Python
  literals (`'I%04d'`, `1`, `True`, `[...]`). A small hand parser is enough
  (strings, ints, bools). Don't evaluate anything.
- **Lines starting with `;;` are settings still at their default**: Gramps
  writes defaults commented out. Treat as "not set" and don't import them,
  so desktop defaults don't overwrite gramps-connect's.
- `place_formats.xml`: `<place_formats><format name levels language street
  reverse/>…` → `DOMParser`.

### Mapping

| Desktop key | → setting | Caveat |
|---|---|---|
| `preferences.place-auto` | `place.auto` | |
| `preferences.place-format` | `place.active` | Index into the imported XML's list; if the XML is absent, only index 0 (built-in "Full") is meaningful |
| `place_formats.xml` | `place.formats` | |
| `preferences.date-format` | `date.format` | **Locale-dependent index**: decoded via `desktopDateFormatMap` + the preview's "Desktop language" select (see Resolved questions #4) |
| `preferences.name-format` | `name.format` | A number: 0 → `""` (server default); 1–5 → the built-in's format string; negative → look up `number` in this tree's `/api/name-formats/`. Desktop keeps custom formats in the tree DB, so a negative number only resolves if it's the same tree; otherwise leave unticked |
| `preferences.iprefix`…`nprefix` | (future) client ID templates | Import only once client-assigned IDs exist |
| `behavior.max-age-prob-alive`, `max-sib-age-diff`, `avg-generation-gap`, `min-generation-years` | (future) `/api/living/` args | Display-only; never affects server privacy |
| `preferences.no-surname-text`, `no-given-text`, `private-*-text` | (future) client name rendering | |

Ignore everything else (`interface.*`, `paths.*`, `database.*`, `colors`,
`geography`, `utf8.*`, `researcher.*`; researcher already lives in the tree
DB).

### Dialog flow
1. Pick file(s), then parse.
2. Preview table: setting / desktop value (rendered as an example, e.g.
   a formatted sample date and place) / current value / checkbox (default
   on only where they differ).
3. Apply: merge the checked items into `display` and save with the same
   read-modify-write. One-shot copy, no sync.
4. Errors: wrong file (no `[preferences]` section), unparseable XML: show
   inline, import nothing.

### Wiki
Add "Importing settings from Gramps desktop" next to Phase 1's docs, with
the file locations per OS.

## Out of scope / not fixable client-side

- **Exports** (GEDCOM PLAC lines, CSV, etc.) and server-side `?sort=place`
  / `?sort=title` keep the server's formats.
- Server privacy/living decisions keep the server's probably-alive
  constants.
- `date-before/after/about-range` (server Gramps filters; GOQL compares
  `sortval` directly).
- `utf8.*` symbols, `cite-plugin` (server-rendered report text).
- An upstream route, if ever proposed: `place_format` / `date_format`
  request args mirroring `name_format`. Not part of this plan.

## Resolved questions (2026-10-06)

1. **The Display section lives in Administration** (`AdministrationDialog.tsx`).
2. **No per-user overrides**: per-tree only.
3. **Name formats, verified in gramps-web-api source:**
   - `GET /api/name-formats/` (`resources/name_formats.py`) returns
     `db_handle.name_formats`: **only the tree's custom formats**, as
     `{number, name, format, active}`, with negative `number`s. Often
     empty. Built-ins are **not** included; they're
     `NameDisplay.STANDARD_FORMATS` (`gen/display/name.py:394`): 0 Default
     (`""`), 1 "Surname, Given Suffix" (`%l, %f %s`), "Given" (`%f`),
     "Given Surname Suffix" (`%f %l %s`), "Main Surnames, Given Patronymic
     Suffix Prefix" (`%1m %2m %o, %f %1y %s %0m`). Hardcode these in TS.
   - The `name_format` **request arg is a format string, not a number**
     (validated by `NAME_FORMAT_REGEXP`, `const.py:224`), and only changes
     `profile.name_display` (`util.py:843`). So the setting stores the
     string.
   - **Custom formats come back in desktop's keyword form**
     (`"SURNAME, given (common)"`, seen live on the layer3 fixture), which
     the API's regexp rejects with a 422. `nameKeywordsToCodes()` ports
     `NameDisplay._make_fn`'s English keyword pass (→ `%L, %f (%x)`,
     verified to render server-side). Formats still invalid after that
     (translated keywords, `!` prefix) are listed but disabled.
4. **Date-format support, findings:**
   - `packages/gramps-date` has one locale (`en`) and the six base
     `DateDisplay` formats (`DateFormat` 0–5 = ISO, Numeric, Month Day Year,
     MON Day Year, Day Month Year, Day MON Year). gramps-connect never
     passes a locale to `formatDate()`, so dates are English even in a
     translated UI (existing gap, separate from this plan).
   - Desktop has ~30 `_date_<lang>.py` displayers, **each with its own
     `formats` list, 2–9 entries**, and **the same index means different
     things in different languages**: English 2 = "Month Day, Year", French
     2 = "Jour Mois Année" (Day Month Year). French has 9, German 7 (6 =
     numeric with leading zeros), es/it/nl/pl… 6 in the English order,
     el/hu/sr 5, lt/sv 4 (sv is year-first), fi 3, zh_CN/zh_TW 2.
   - `gramps.ini` **doesn't record the desktop language** (it comes from
     the environment), so the index alone can't be decoded.
   - **Decision for Phase 2:** offer only the six `DateFormat`s, as today.
     Localized month names belong in a separate `gramps-date` locales effort.
   - **Decision for Phase 3:** ship a small data table
     `desktopDateFormatMap[lang][index] → DateFormat | null`, generated from
     each `_date_<lang>.py`'s `formats` tuple (nearest semantic match; e.g.
     fr 8 "JJ/MM/AAAA" → NUMERIC, de 6 → NUMERIC, sv year-first formats →
     null). The import preview has a **"Desktop language" select**
     (defaulting to the gramps-connect UI language) that drives the
     mapping. It shows the rendered example and leaves the checkbox
     unticked when the mapping is `null`.

## Testing

- `placeDisplay.ts` unit tests: levels slices, `p` offsets, street merge
  both ways, reverse, language selection, date-dependent alt names, cycles,
  missing parents.
- INI parser tests: `;;` defaults skipped, quoted strings with `%`,
  booleans as `1`/`True`, unknown sections ignored.
- Round-trip: save settings → reload tree → same rendering; PUT preserves
  unrelated blob keys.
- Check rendered output in Tree/Fan/Family Graph labels, tables, Timeline,
  Story, search snippets, and both table ordering codepaths, not just the
  settings state.

## Follow-ups (implemented 2026-10-06)

- **Date input follows the date format.** `DateInput.tsx`'s quick-entry
  buffer uses `formatDisplayDate()`. Safe because every format round-trips
  through `parseDate()` (qualifiers, ranges/spans, partial, dual-dated,
  Julian, BCE, text-only). That's now a permanent test,
  `packages/gramps-date/src/__tests__/roundtrip.test.ts`.
- **Gramps ID templates for new records** (`ids` in the settings blob,
  Preferences → New records, imported from iprefix..nprefix).
  `store/grampsIds.ts` + `createObjects()`:
  - Next = highest number matching the template in the type's cache + 1.
    Each candidate is checked on the server (`gramps_id == "…"` count),
    since caches can be partial or filtered (Notes' baseFilter).
  - gramps-web-api's POST /api/objects/ uses `add_object(...,
    fail_if_exists=True)`: a duplicate Gramps ID gets a 400 and the DbTxn
    aborts (verified live: N0016 duplicate → 400, nothing written).
    `createObjects()` retries once with fresh IDs.
  - Differs from desktop: no gap-filling (desktop's counter restarts at 0
    on each tree open).
- **Places sort by `name.value`, then `title`** (2026-10-06). gramps-web-api's
  `order_by` accepts paths since #962. The stale "flat columns only"
  comment in views.ts was what blocked this. New `ColumnConfig.sortBy`
  (what a header click sorts by) and `orderPath` (this column caches that
  path's value, for `globalRankOfItem`'s "before" comparisons).
  Measured on the 100k Postgres fixture, per 1000-row page: places
  `title` ~50 ms vs `name.value` ~58 ms; people `surname` 0.31 s vs
  `birth.date.sortval` **4.2 s**. So Birth/Death (and other
  relationship-path) sorting stays off.

## Localized dates: gramps-date matches Gramps exactly (2026-10-06)

- `packages/gramps-date` ships en, en_GB, de, fr, es. Strings are
  generated from a live Gramps by `scripts/generate_gramps_locales.py`
  (`locales/<lang>.generated.ts`). Layouts are hand-written per language
  (`locales/<lang>.ts`).
- Verified against Gramps' own output: `fixtures/gramps-<lang>.json` (every
  format number, display + Gramps' parse of it, typed input) and
  `fixtures/gramps-tests-<lang>.json`, which reuses the date sets Gramps'
  own unit tests build (date_test.py, datehandler_test.py), about 47k
  checks. Hand-written Gramps tests are ported in `grampsUnit.test.ts`.
- Fixed along the way to match Gramps: language layouts apply only to
  Gregorian dates (other calendars use base layouts); German/French
  numeric quirks; text patterns per language (day dot, no month dot,
  unanchored end); Swedish calendar validity range; text-only text after
  stripping; empty input becomes text-only ""; slash dates become Julian;
  `_adjust_newyear` in sort values; Hebrew and Persian sort values
  (previously 0).
- One deliberate environment fix: the generator sets each parser's
  numeric order from the language's display pattern, because Gramps takes
  it from the *process* locale (en_GB parsed month-first under a US
  process).
- The app writes dates in the interface language (`dateLocaleCode()` in
  placeIndex.ts) and parses DateInput in it. Preferences labels use
  Gramps' own format names in that language.
- Open: Preferences still offers six formats. A language's extra ones
  (German 6, French 4/5/8) are reachable via `grampsFormat` but not
  selectable. Inflected languages (ru, uk, cs, hr, sl) need the Lexeme
  port.
- **Per-language formats in Preferences (2026-10-06).** The picker lists
  the interface language's own Gramps formats. Stored as `date.format`
  (shared DateFormat) plus `date.byLanguage[localeCode] = index` for a
  language-only pick (`chooseGrampsFormat`, `grampsFormatFor`,
  `sharedFormatFor` in displaySettings.ts). The desktop import maps a
  ported language's format number exactly; other languages use the old
  nearest-match table.
