#!/usr/bin/env python3
"""Generate gramps-date locale data and test vectors from a real Gramps.

    python3 packages/gramps-date/scripts/generate_gramps_locales.py de fr es

For each language this writes:

  src/locales/<lang>.generated.ts   every *string* the displayer/parser uses,
                                    read from Gramps' live DateDisplay/
                                    DateParser objects (class attributes are
                                    not enough: translations replace many of
                                    them at runtime -- German's class says
                                    "etwa", the live displayer says "um")
  src/__tests__/fixtures/gramps-<lang>.json
                                    what Gramps displays for a set of dates in
                                    every one of that language's format
                                    numbers, and what Gramps' parser makes of
                                    each displayed string

Layouts (day/month order, "12." vs "12", zero padding) are *not* generated --
they live in hand-written src/locales/<lang>.ts, checked against the vectors
by src/__tests__/locales.test.ts.

Needs Gramps importable with compiled translations (see the app's
scripts/compile-gramps-translations.py).
"""

import json
import os
import re
import sys

# Importing the datehandler first sets up Gramps' default locale and its
# localedir; a GrampsLocale(lang=...) created before that has no
# translations at all (every string comes out English).
from gramps.gen.datehandler import parser as _default_parser  # noqa: F401
from gramps.gen.lib import Date
from gramps.gen.utils.grampslocale import GrampsLocale

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")

# Sentinel years for template extraction: no locale renders these digits
# differently, and they can't collide with anything else in the output.
Y1, Y2 = 1111, 2222


def py_to_js_regex(pattern):
    """Gramps' patterns are used with re.match (anchored at the start) and
    Python's (?P<name>...) groups."""
    return "^" + pattern.replace("(?P<", "(?<")


def make_date(quality, modifier, calendar, start, stop=None, newyear=0, text=""):
    date = Date()
    value = tuple(start) + (tuple(stop) if stop else ())
    date.set(quality=quality, modifier=modifier, calendar=calendar, value=value, text=text, newyear=newyear)
    return date


def date_json(date):
    return {
        "modifier": date.get_modifier(),
        "quality": date.get_quality(),
        "calendar": date.get_calendar(),
        "dateval": list(date.get_start_date()) + (list(date.get_stop_date()) if date.is_compound() else []),
        "newyear": date.get_new_year(),
        "text": date.get_text() if date.get_modifier() == Date.MOD_TEXTONLY else "",
        "sortval": date.get_sort_value(),
    }


def templates(dd):
    """Turn sentinel renderings back into templates with {quality} {start}
    {stop} {date} {calendar} placeholders. Rendered in ISO (format 0), so the
    dates are just the sentinel years."""
    dd.set_format(0)
    qual = dd._qual_str[Date.QUAL_ESTIMATED]
    scal = dd.format_extras(Date.CAL_JULIAN, 0)

    def to_template(rendered, pairs):
        out = rendered
        if not out.startswith(qual):
            raise SystemExit(f"quality not at the start of {rendered!r} -- extend templates()")
        out = "{quality}" + out[len(qual):]
        if not out.endswith(scal):
            raise SystemExit(f"calendar suffix not at the end of {rendered!r}")
        out = out[: -len(scal)] + "{calendar}"
        for literal, placeholder in pairs:
            if out.count(literal) != 1:
                raise SystemExit(f"{literal!r} not exactly once in {rendered!r}")
            out = out.replace(literal, placeholder)
        return out

    est, jul = Date.QUAL_ESTIMATED, Date.CAL_JULIAN
    span = dd.display(make_date(est, Date.MOD_SPAN, jul, (0, 0, Y1, False), (0, 0, Y2, False)))
    rng = dd.display(make_date(est, Date.MOD_RANGE, jul, (0, 0, Y1, False), (0, 0, Y2, False)))
    modifiers = []
    for mod in range(9):
        if mod in (Date.MOD_RANGE, Date.MOD_SPAN, Date.MOD_TEXTONLY):
            modifiers.append("")
            continue
        rendered = dd.display(make_date(est, mod, jul, (0, 0, Y1, False)))
        modifiers.append(to_template(rendered, [(str(Y1), "{date}")]))
    return {
        "span": to_template(span, [(str(Y1), "{start}"), (str(Y2), "{stop}")]),
        "range": to_template(rng, [(str(Y1), "{start}"), (str(Y2), "{stop}")]),
        "modifiers": modifiers,
    }


# Calendar -> (Gramps' month-name-first pattern, day-first pattern, the
# month-alternation attribute they embed), as _parse_calendar uses them.
TEXT_PATTERNS = {
    "gregorian": ("_text", "_text2", "_mon_str"),  # also Julian
    "swedish": ("_stext", "_stext2", "_mon_str"),
    "hebrew": ("_jtext", "_jtext2", "_jmon_str"),
    "french": ("_ftext", "_ftext2", "_fmon_str"),
    "persian": ("_ptext", "_ptext2", "_pmon_str"),
    "islamic": ("_itext", "_itext2", "_imon_str"),
}


def text_patterns(dp):
    """Each calendar's text patterns with the month alternation replaced by
    {months}: languages differ here (German/French allow any one character
    after the day -- "12. März" -- forbid a dot after the month, and leave
    the end unanchored, so trailing text is ignored)."""
    out = {}
    for calendar, (text, text2, months) in TEXT_PATTERNS.items():
        alternation = getattr(dp, months)
        pair = {}
        for key, attr in (("text", text), ("text2", text2)):
            pattern = getattr(dp, attr).pattern
            if pattern.count(alternation) != 1:
                raise SystemExit(f"{attr}: month alternation not found exactly once")
            pair[key] = "^" + pattern.replace(alternation, "{months}")
        out[calendar] = pair
    return out


def numeric_order(dhformat):
    order = sorted((dhformat.index(token), name) for token, name in (("%d", "d"), ("%m", "m"), ("%Y", "y")))
    return "".join(name for _, name in order)


def strings(lang, loc):
    dd, dp = loc.date_displayer, loc.date_parser
    order = numeric_order(dd.dhformat)
    return {
        "code": lang,
        "longMonths": list(dd.long_months),
        "shortMonths": list(dd.short_months),
        "hebrewMonths": list(dd.hebrew),
        "frenchMonths": list(dd.french),
        "islamicMonths": list(dd.islamic),
        "persianMonths": list(dd.persian),
        "calendarNames": list(dd.calendar),
        "modifierStrings": list(dd._mod_str),
        "qualityStrings": list(dd._qual_str),
        "numericFormat": dd.dhformat,
        "bceFormat": dd._bce_str,
        "templates": templates(dd),
        "modifierWords": dict(sorted(dp.modifier_to_int.items())),
        "modifierWordsAfterDate": dict(sorted(getattr(dp, "modifier_after_to_int", {}).items())),
        "qualityWords": dict(sorted(dp.quality_to_int.items())),
        "calendarWords": dict(sorted(dp.calendar_to_int.items())),
        "bceWords": list(dp.bce),
        # Gramps' parsers share one month_to_int dict (each _date_xx.py adds
        # its aliases to DateParser.month_to_int itself), so every language
        # accepts every other's month names -- exported whole, so the port
        # accepts exactly what Gramps does.
        "monthWords": dict(sorted(dp.month_to_int.items())),
        "textPatterns": text_patterns(dp),
        "spanPattern": py_to_js_regex(dp._span.pattern),
        "rangePattern": py_to_js_regex(dp._range.pattern),
        "numericOrder": order if order in ("dmy", "mdy", "ymd") else "dmy",
        # A gettext context ("date format\x04Numerical") can leak into a
        # name that has no translation; keep just the name.
        "formatNames": [name.split("\x04")[-1] for name in dd.formats],
    }


G, J, H, F, I, P, S = (Date.CAL_GREGORIAN, Date.CAL_JULIAN, Date.CAL_HEBREW, Date.CAL_FRENCH,
                       Date.CAL_ISLAMIC, Date.CAL_PERSIAN, Date.CAL_SWEDISH)
N, EST, CALC = Date.QUAL_NONE, Date.QUAL_ESTIMATED, Date.QUAL_CALCULATED


def sample_dates():
    """Every display path: plain/partial/slash/BCE Gregorian, each modifier
    and quality, span/range, and every calendar."""
    out = []
    for part in [(12, 3, 1854, False), (0, 3, 1854, False), (0, 0, 1854, False), (1, 1, 1900, False),
                 (31, 12, 1999, False), (11, 2, 1745, True), (5, 10, 1582, False), (1, 1, -100, False),
                 (0, 0, -44, False)]:
        out.append(make_date(N, Date.MOD_NONE, G, part))
    for mod in (Date.MOD_BEFORE, Date.MOD_AFTER, Date.MOD_ABOUT, Date.MOD_FROM, Date.MOD_TO):
        out.append(make_date(N, mod, G, (12, 3, 1854, False)))
        out.append(make_date(N, mod, G, (0, 3, 1854, False)))
    for qual in (EST, CALC):
        out.append(make_date(qual, Date.MOD_NONE, G, (12, 3, 1854, False)))
        out.append(make_date(qual, Date.MOD_ABOUT, G, (0, 0, 1854, False)))
    for mod in (Date.MOD_SPAN, Date.MOD_RANGE):
        out.append(make_date(N, mod, G, (1, 2, 1890, False), (3, 3, 1910, False)))
        out.append(make_date(EST, mod, G, (0, 0, 1890, False), (0, 0, 1910, False)))
    out.append(make_date(N, Date.MOD_NONE, J, (12, 1, 1700, False)))
    out.append(make_date(N, Date.MOD_NONE, J, (11, 2, 1745, False), newyear=Date.NEWYEAR_MAR25))
    out.append(make_date(N, Date.MOD_BEFORE, J, (0, 0, 1700, False)))
    out.append(make_date(N, Date.MOD_NONE, S, (1, 3, 1712, False)))
    for cal, part in ((H, (1, 1, 5600, False)), (H, (0, 7, 5600, False)), (F, (1, 1, 10, False)),
                      (I, (12, 9, 1300, False)), (P, (1, 1, 1300, False))):
        out.append(make_date(N, Date.MOD_NONE, cal, part))
    out.append(make_date(N, Date.MOD_TEXTONLY, G, (0, 0, 0, False), text="around the war"))
    return out


# Things people type, per language (plus some English, which Gramps accepts
# everywhere through the shared tables) -- parsed by Gramps, and the port must
# agree.
TYPED = {
    "_all": ["1854", "Mar 1854", "12 March 1854", "March 12, 1854", "1854-03-12", "12/3/1854", "3/12/1854",
             "about 1854", "abt 1854", "before 1900", "after 1900", "between 1850 and 1860", "from 1850 to 1860",
             "1745/6", "12 Jan 1700 (Julian)", "est 1800", "100 BC", "Q2 1900", "hello world", ""],
    "en": ["c. 1850", "bef. Mar 1900", "calc 1800"],
    "de": ["um 1850", "ca. 1850", "vor Mrz 1900", "nach 1900", "zwischen 1850 und 1860", "von 1850 bis 1860",
           "12.3.1854", "12. März 1854", "12. Mrz. 1854", "geschätzt 1800", "ab 1850", "bis 1860", "1854 v. Chr.",
           "Jänner 1850", "Hornung 1850"],
    "fr": ["vers 1850", "env. 1850", "avant mars 1900", "après 1900", "entre 1850 et 1860", "de 1850 à 1860",
           "12/3/1854", "12 mars 1854", "1er mars 1854", "estimée 1800", "calculée 1800"],
    "es": ["hacia 1850", "aprox. 1850", "antes de marzo 1900", "después de 1900", "entre 1850 y 1860",
           "de 1850 a 1860", "12/3/1854", "12 marzo 1854", "estimado 1800"],
}


def typed_vectors(lang, loc):
    dp = loc.date_parser
    return [{"text": text, "parsed": date_json(dp.parse(text))} for text in TYPED["_all"] + TYPED.get(lang, [])]


def vectors(loc):
    dd, dp = loc.date_displayer, loc.date_parser
    result = []
    for date in sample_dates():
        shown = []
        for index in range(len(dd.formats)):
            dd.set_format(index)
            text = dd.display(date)
            parsed = dp.parse(text)
            shown.append({"text": text, "parsed": date_json(parsed), "grampsRoundTrips": parsed.is_equal(date)})
        result.append({"date": date_json(date), "formats": shown})
    return result


def gramps_test_sets():
    """The date sets Gramps' own unit tests build, captured from the test
    modules themselves rather than retyped: gen/lib/test/date_test.py's
    module-level date_tests (ParserDateTest: display -> parse in every
    format) and swedish_dates (SwedishDateTest), and the dates
    gen/datehandler/test/datehandler_test.py's DateHandlerTest builds per
    test and hands to its private all-languages helper (intercepted here;
    run in format 0 only, as that test does)."""
    from gramps.gen.lib.test.date_test import date_tests, swedish_dates
    from gramps.gen.datehandler.test.datehandler_test import DateHandlerTest

    sets = [(f"date_test: {name}", dates, "all") for name, dates in date_tests.items()]
    sets.append(("date_test: swedish", swedish_dates, "all"))
    for name in ("test_simple", "test_span", "test_textual"):
        case = DateHandlerTest(name)
        captured = []
        case._DateHandlerTest__base_test_all_languages = captured.extend
        case.setUp()
        getattr(case, name)()
        sets.append((f"datehandler_test: {name}", captured, "iso"))
    return sets


def compact(date):
    d = date_json(date)
    return [d["modifier"], d["quality"], d["calendar"], d["dateval"], d["newyear"], d["text"], d["sortval"]]


def structured(d):
    return [d[0], d[1], d[2], d[3], d[4], d[5] if d[0] == Date.MOD_TEXTONLY else ""]


def test_set_vectors(loc, sets):
    """Per set, per date: the date (compact), then per format either the
    displayed text alone -- Gramps parses it back to the same date -- or
    [text, what Gramps parses it to]."""
    dd, dp = loc.date_displayer, loc.date_parser
    out = []
    for name, dates, scope in sets:
        formats = range(len(dd.formats)) if scope == "all" else [0]
        rows = []
        for date in dates:
            original = compact(date)
            shown = []
            for index in formats:
                dd.set_format(index)
                text = dd.display(date)
                parsed = compact(dp.parse(text))
                shown.append(text if structured(parsed) == structured(original) else [text, parsed])
            rows.append([original, shown])
        out.append({"name": name, "formats": list(formats), "dates": rows})
    return out


TS_HEADER = """// GENERATED by scripts/generate_gramps_locales.py from Gramps' live
// date displayer/parser for "{lang}" -- do not edit by hand; re-run the
// script. Layouts live in the hand-written ./{lang}.ts.
//
// Original strings: Gramps (gramps/gen/datehandler/_date_{lang}.py,
// _datestrings.py and the "{lang}" translation catalog), GPL v2 or later.

"""


def align_parser_numeric_order(lang, loc):
    """Gramps' parser takes its numeric day/month order from the locale
    table entry for the *process's* locale (DateParser.__init__ via
    locale_tformat), so a parser built here for another language can come
    out with this machine's order -- en_GB parsing "4/1/1789" month-first
    while its displayer writes day-first. Running Gramps in that language,
    the two agree; set the parser from the displayer's pattern to match,
    with the same rules as DateParser.__init__."""
    dp, dd = loc.date_parser, loc.date_displayer
    if dp.dhformat == dd.dhformat:
        return
    print(f"{lang}: parser numeric order {dp.dhformat!r} -> displayer's {dd.dhformat!r}")
    dp.dhformat = dd.dhformat
    match = dp._dhformat_parse.match(dp.dhformat.lower())
    groups = match.groups() if match else None
    dp._ddmy = groups == ("a", "e", "b", "y")
    dp.dmy = groups is None or groups in (("d", "m", "y"), ("e", "m", "y"), ("d", "b", "y"), ("a", "e", "b", "y"))
    dp.ymd = groups in (("y", "m", "d"), ("y", "b", "d"))


def main(langs):
    os.makedirs(os.path.join(SRC, "__tests__", "fixtures"), exist_ok=True)
    sets = gramps_test_sets()
    for lang in langs:
        loc = GrampsLocale(lang=lang)
        align_parser_numeric_order(lang, loc)
        if loc.date_displayer.long_months[1] == "January" and not lang.startswith("en"):
            raise SystemExit(f"{lang}: translations didn't load (English month names)")
        data = strings(lang, loc)
        ts = TS_HEADER.format(lang=lang)
        ts += f"export const {lang}Strings = {json.dumps(data, ensure_ascii=False, indent=2)} as const;\n"
        with open(os.path.join(SRC, "locales", f"{lang}.generated.ts"), "w", encoding="utf-8") as f:
            f.write(ts)
        with open(os.path.join(SRC, "__tests__", "fixtures", f"gramps-{lang}.json"), "w", encoding="utf-8") as f:
            json.dump({"lang": lang, "formatNames": data["formatNames"], "vectors": vectors(loc),
                       "typed": typed_vectors(lang, loc)}, f, ensure_ascii=False, indent=1)
        with open(os.path.join(SRC, "__tests__", "fixtures", f"gramps-tests-{lang}.json"), "w", encoding="utf-8") as f:
            json.dump({"lang": lang, "sets": test_set_vectors(loc, sets)}, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{lang}: {len(data['formatNames'])} formats, templates {data['templates']['range']!r}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["en", "en_GB", "de", "fr", "es"])
