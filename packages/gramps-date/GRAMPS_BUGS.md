# Gramps date-handler bugs found while porting

gramps-date matches Gramps' date display and parsing in all 43 languages,
except where Gramps is wrong. The test of "wrong" is Gramps' own
`DateHandlerTest` rule: a displayed date must parse back to the same date.
Where Gramps breaks that rule, crashes, or loses what the user typed,
gramps-date does the right thing instead. Each case is listed here so it can
be reported or fixed upstream.

Checked against Gramps 6.0 (`maintenance/gramps60`, 32aa29629b). The counts
come from `scripts/generate_gramps_locales.py`, which runs Gramps' own unit-test
date sets through every language and format.

## Crashes

| Language | Where | What happens |
|---|---|---|
| cs | `cs.po`, "between" in `FORMATS_long_month_year` | The translation asks for month form `X`, which no Czech month has: `KeyError: 'X'` for every "between" date with a month (932 cases). gramps-date uses the "and" form instead. |
| fi | `fi.po`, the `"…-date"` inflection keys | The translators translated the keys themselves ("ennen", "kuukaudesta"), so `FORMATS_*_month_year[inflect]` raises `KeyError` for every modified month-and-year date. gramps-date uses the English keys. |
| fi | `DateDisplayFI.dd_dformat04` | A plain month and year uses `.forms[IN]` even when the month list has no forms (non-Gregorian calendars): `AttributeError`. |
| hu | `DateDisplayHU.roman_months` | The list stops at XII, so Hebrew and French month 13 raise `IndexError`. gramps-date adds "XIII.". |
| is | `DateDisplayIS._get_weekday` | It lacks the BCE-year and month-13 guards that the base `_get_long_weekday` has: `ValueError` for 27 dates. |
| sq | base `DateParser` | Albanian's numeric format is year-first (`%Y/%b/%d`), and the resulting `ymd` flag is also applied to the day-first text patterns, so the parser looks up "1789" as a month name: `KeyError` (613 cases). |
| sv | `DateParserSv` | `KeyError: '4'` while parsing its own displayed dates (168 cases). |

## Displayed dates that don't read back

- **Base-handler languages can't read their own month names.** Languages
  without their own date handler (for example ba, eo, ga, ko, ta, tr, vi)
  get a parser month table without the translated names the displayer
  prints.
- **The displayed calendar, quality and modifier words** are often not in the
  parser's word lists. For example, the translated calendar name shown in
  parentheses is not recognised.
- **Signed BCE years.** Numeric formats print "-44 B.C.E." and "4.11.-90 v. u. Z.":
  the sign and the marker together, which read back wrong in most languages.
  gramps-date drops the sign.
- **`%e` left literal (bg).** `dd_dformat01` replaces `%d` but not `%e`, so
  Bulgarian numeric dates contain the text "%e".
- **Numeric formats using `%b`, `%a` or `%A` (ar, nb, ta)** display, but the
  numeric parser can't read them back.
- **Hebrew.** The modifier prefix "מ" swallows the first letter of "מרץ"
  (March).
- **Icelandic.** A bare year doesn't parse, and "4. Tammuz 1789" fails because
  the Hebrew pattern doesn't allow the dot after the day.
- **Hungarian.**
  - It writes BCE first ("i. e. 90"), but the shared `bce` pattern only looks
    for the marker after the date.
  - Its `_display_calendar` uses Gregorian month names for every calendar.
- **Swedish.** Hebrew, Islamic and Persian dates aren't range-checked, so
  "1789 Tammuz 4" parses with day 1789.
- **Shared month table.** Words that aren't months get into the
  cross-language table, such as "1".."12", "-" and "to". So Norwegian
  "4. 1 1789" is read as month 4, day 1.
- **Month names translated the same.** Czech and Polish give Adar I and
  Adar II the same name ("Adar"), and Slovenian translates Aban as "Mehr",
  the name of the month before. Those months can't be told apart.
  gramps-date shows Gramps' English names for the clashing months.
- **Greek and Polish month-number formats** ("4-1-1789", "1.4.1789") read the
  same as the numeric format, with day and month swapped. gramps-date
  parses with the format the date was shown in when that is known.

## Wrong but readable

- **Russian.** `DateDisplayRU.dd_dformat05` checks `hasattr(month, "f")`
  instead of `"forms"`, so short-month day dates never take the genitive
  ("4 май 1789" instead of "4 мая 1789").
- **Slovak.** `DateDisplaySK.display()` predates inflection and never passes
  the context, so the translation's "od" + genitive is ignored ("od január").

## Lost input

- **Text-only dates are stripped.** When parsing fails, Gramps keeps the text
  left after it removed the calendar, quality and BCE parts ("-44" from
  "-44 B.C.E."), not what was typed.
- **Empty input becomes text-only.** `parse("")` gives a text-only date
  instead of an empty one.

## Generator-only

- **Parser state leaks between languages.** `DateParser` keeps its month
  tables and patterns in class attributes, so in one process, one
  language's words leak into the next language's parser. This affects tools
  that load several languages, such as this generator, which now runs each
  language in its own process.
