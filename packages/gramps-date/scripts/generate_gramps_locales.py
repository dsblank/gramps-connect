#!/usr/bin/env python3
"""Generate gramps-date locale data and test vectors from a real Gramps.

    python3 packages/gramps-date/scripts/generate_gramps_locales.py [lang ...] [--strings-only]

Without languages: English plus every language in Gramps' po/LINGUAS, each
in its own process, in parallel (Gramps' parser keeps state in class
attributes, which leaks from one language into the next in one process).
For each language this writes:

  src/locales/<lang>.generated.ts   every *string* the displayer/parser uses,
                                    read from Gramps' live DateDisplay/
                                    DateParser objects (class attributes are
                                    not enough: translations replace many of
                                    them at runtime -- German's class says
                                    "etwa", the live displayer says "um"),
                                    including inflected month forms
  src/__tests__/fixtures/gramps-<lang>.json.gz
                                    what Gramps displays for a set of dates in
                                    every one of that language's format
                                    numbers, and what Gramps' parser makes of
                                    each displayed string and of typed input
  src/__tests__/fixtures/gramps-tests-<lang>.json.gz
                                    the same for the date sets of Gramps' own
                                    unit tests

and src/locales/available.generated.ts, the list of loadable languages.

Layouts (day/month order, "12." vs "12", zero padding) are *not* generated:
languages whose displayer lays dates out its own way are hand-written in
src/locales/index.ts, checked against the vectors by the tests.

Needs Gramps importable with compiled translations (see the app's
scripts/compile-gramps-translations.py).
"""

import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

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
    body = pattern.replace("(?P<", "(?<")
    return body if body.startswith("^") else "^" + body


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
    {stop} {date} {calendar} placeholders -- one set per quality (none,
    estimated, calculated), since some languages word a date differently
    with a quality (Hebrew adds "ב־" only then). Rendered in ISO (format 0),
    so the dates are just the sentinel years."""
    dd.set_format(0)
    scal = dd.format_extras(Date.CAL_JULIAN, 0)
    jul = Date.CAL_JULIAN

    def per_quality(quality):
        qual = dd._qual_str[quality]

        def to_template(rendered, pairs):
            # Each piece wherever the language puts it (Finnish:
            # "arviolta 1111 ja 2222 (juliaaninen) välillä"), as long as it
            # occurs exactly once.
            out = rendered
            pieces = ([(qual, "{quality}")] if qual else []) + [(scal, "{calendar}")] + pairs
            for literal, placeholder in pieces:
                if out.count(literal) != 1:
                    raise SystemExit(f"{literal!r} not exactly once in {rendered!r} -- extend templates()")
                out = out.replace(literal, placeholder)
            return out

        span = dd.display(make_date(quality, Date.MOD_SPAN, jul, (0, 0, Y1, False), (0, 0, Y2, False)))
        rng = dd.display(make_date(quality, Date.MOD_RANGE, jul, (0, 0, Y1, False), (0, 0, Y2, False)))
        modifiers = []
        for mod in range(9):
            if mod in (Date.MOD_RANGE, Date.MOD_SPAN, Date.MOD_TEXTONLY):
                modifiers.append("")
                continue
            rendered = dd.display(make_date(quality, mod, jul, (0, 0, Y1, False)))
            modifiers.append(to_template(rendered, [(str(Y1), "{date}")]))
        return {
            "span": to_template(span, [(str(Y1), "{start}"), (str(Y2), "{stop}")]),
            "range": to_template(rng, [(str(Y1), "{start}"), (str(Y2), "{stop}")]),
            "modifiers": modifiers,
        }

    return [per_quality(quality) for quality in (Date.QUAL_NONE, Date.QUAL_ESTIMATED, Date.QUAL_CALCULATED)]


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


# Gramps parser regex attribute -> exported name. All are used with
# re.match (anchored at the start), so each gets a leading "^".
PARSER_PATTERNS = {
    "_abt2": "aboutBrackets", "_bce_re": "bce", "_cal": "calendar", "_calny": "calendarNewyear",
    "_calny_iso": "calendarNewyearIso", "_iso": "iso", "_isotimestamp": "isoTimestamp",
    "_modifier": "modifier", "_modifier_after": "modifierAfter", "_numeric": "numeric", "_ny": "newyear",
    "_ny_iso": "newyearIso", "_qual": "quality", "_quarter": "quarter", "_range": "range", "_span": "span",
    "_today": "today", "_rfc": "rfc",
}


# The word-list alternations Gramps embeds in its patterns (init_strings),
# exported as placeholders: the port fills each with Gramps' words *plus*
# the words it displays, so every displayed date reads back (Gramps' own
# parsers don't always accept their displayers' words -- e.g. Spanish
# "(Republicano francés)").
ALTERNATIONS = {
    "_bce_str": "{bce}", "_qual_str": "{qualities}", "_mod_str": "{modifiers}",
    "_mod_after_str": "{modifiersAfter}", "_cal_str": "{calendars}", "_ny_str": "{newyears}",
}


def parser_patterns(dp):
    """Every compiled pattern the parser matches with, as JS regex source +
    flags, word lists as placeholders (ALTERNATIONS) -- languages override
    some patterns (init_strings), so all are exported rather than rebuilt."""
    import re as _re
    out = {}
    for attr, name in PARSER_PATTERNS.items():
        pattern = getattr(dp, attr)
        source = pattern.pattern
        # Longest first, so one alternation inside another can't be split.
        for alt_attr, placeholder in sorted(ALTERNATIONS.items(), key=lambda kv: -len(getattr(dp, kv[0], "") or "")):
            alternation = getattr(dp, alt_attr, None)
            if alternation and alternation in source:
                source = source.replace(alternation, placeholder)
        out[name] = {"source": py_to_js_regex(source), "ignoreCase": bool(pattern.flags & _re.IGNORECASE)}
    return out


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


# Per calendar, the months distinct_months renamed: Gramps' text for them is
# ambiguous, so it's no reference even where it happens to read back.
COLLIDED = {}


def collided(date):
    months = {date.get_month()} | ({date.get_stop_month()} if date.is_compound() else set())
    return bool(COLLIDED.get(date.get_calendar(), set()) & months)


def distinct_months(lang, names, english, calendars):
    """Month names with translation collisions undone: where two months
    share a translation (cs/pl both Adars "Adar", sl Persian "Mehr" for
    Aban too) neither can read back, so those months keep Gramps' English
    names. A Gramps translation bug, reported upstream."""
    names = [str(n) for n in names]
    folded = [n.lower() for n in names]
    for i in range(1, len(names)):
        if folded.count(folded[i]) > 1:
            print(f"{lang}: month {i} {names[i]!r} shared with another month; using {english[i]!r}", flush=True)
            names[i] = english[i]
            for calendar in calendars:
                COLLIDED.setdefault(calendar, set()).add(i)
    return names


INFLECT_KEYS = ("", "from", "to", "between", "and", "before", "after", "about", "estimated", "calculated")


def month_year_formats(formats):
    """FORMATS_long/short_month_year: per inflection context, the case form
    it takes ("{long_month.forms[Р]} {year}" -> "Р") and its template."""
    out = {}
    for key in INFLECT_KEYS:
        m = re.fullmatch(r"(.*)\{(?:long|short)_month(?:\.forms\[([^\]]+)\])?\}(.*)", str(formats[key]))
        out[key] = {"form": m.group(2), "template": f"{m.group(1)}{{month}}{m.group(3)}"}
    return out


def inflection(dd):
    """Month names with grammatical forms (Lexemes: cs, fi, hr, ru, sk, sl,
    uk), per month list, and the forms each context takes -- or None. The
    contexts are Gramps' English keys: Finnish translates the keys
    themselves ("ennen"), which then aren't in FORMATS_*_month_year, so
    Gramps raises KeyError there (a Gramps bug, fixed by not translating)."""
    lists = {"long": dd.long_months, "short": dd.short_months, "hebrew": dd.hebrew,
             "french": dd.french, "islamic": dd.islamic, "persian": dd.persian}
    forms = {name: [dict(m.forms) if hasattr(m, "forms") else None for m in months]
             if hasattr(months[1], "forms") else None for name, months in lists.items()}
    if not any(forms.values()):
        return None
    return {"forms": forms,
            "longMonthYear": month_year_formats(dd.FORMATS_long_month_year),
            "shortMonthYear": month_year_formats(dd.FORMATS_short_month_year)}


def strings(lang, loc):
    dd, dp = loc.date_displayer, loc.date_parser
    en = GrampsLocale(lang="en").date_displayer
    return {
        "code": lang,
        "longMonths": distinct_months(lang, dd.long_months, list(en.long_months), (Date.CAL_GREGORIAN, Date.CAL_JULIAN, Date.CAL_SWEDISH)),
        "shortMonths": distinct_months(lang, dd.short_months, list(en.short_months), (Date.CAL_GREGORIAN, Date.CAL_JULIAN, Date.CAL_SWEDISH)),
        "hebrewMonths": distinct_months(lang, dd.hebrew, list(en.hebrew), (Date.CAL_HEBREW,)),
        "frenchMonths": distinct_months(lang, dd.french, list(en.french), (Date.CAL_FRENCH,)),
        "islamicMonths": distinct_months(lang, dd.islamic, list(en.islamic), (Date.CAL_ISLAMIC,)),
        "persianMonths": distinct_months(lang, dd.persian, list(en.persian), (Date.CAL_PERSIAN,)),
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
        "textPatterns": text_patterns(dp),
        "parserPatterns": parser_patterns(dp),
        # Gramps' parser month tables, exactly -- the only names it accepts
        # (languages without their own parser class never get their month
        # names added, so Gramps can't parse e.g. Turkish "Ocak 4, 1789").
        "monthTables": {
            "gregorian": dict(sorted(dp.month_to_int.items())),
            "swedish": dict(sorted(dp.swedish_to_int.items())),
            "hebrew": dict(sorted(dp.hebrew_to_int.items())),
            "french": dict(sorted(dp.french_to_int.items())),
            "islamic": dict(sorted(dp.islamic_to_int.items())),
            "persian": dict(sorted(dp.persian_to_int.items())),
        },
        # _rfc's (English) month abbreviations.
        "rfcMonths": dict(dp._rfc_mons_to_int),
        # The base layouts' translated templates (dd_dformat02..05), Python
        # str.format syntax -- translators can reorder or punctuate them.
        "baseTextTemplates": {
            "longMonthDayYear": loc.translation.sgettext("{long_month} {day:d}, {year}"),
            "shortMonthDayYear": loc.translation.sgettext("{short_month} {day:d}, {year}"),
            "dayLongMonthYear": loc.translation.sgettext("{day:d} {long_month} {year}"),
            "dayShortMonthYear": loc.translation.sgettext("{day:d} {short_month} {year}"),
        },
        # A second long-month list some displayers use for month-and-year
        # dates (Lithuanian nominative "long_months_vardininkas").
        "altLongMonths": [str(m) for m in getattr(dd, "long_months_vardininkas", ())] or None,
        # Hungarian's own Roman numerals ("I.", "II."); others use plain ones.
        "romanMonths": [str(m) for m in getattr(dd, "roman_months", ())] or None,
        "inflection": inflection(dd),
        # For %a/%A in a numeric pattern (Icelandic).
        "shortDays": [str(day) for day in dd.short_days],
        "longDays": [str(day) for day in dd.long_days],
        # _get_localized_year's addition to a bare year (Croatian: ".").
        "yearSuffix": dd._get_localized_year("1854")[len("1854"):],
        # The parser's own reading of its pattern (DateParser.__init__), after
        # align_parser_numeric_order -- covers %e/%b/%a patterns too.
        "numericOrder": "ymd" if dp.ymd else "dmy" if dp.dmy else "mdy",
        # Icelandic's "%a %e.%b %Y" sets DateParser._ddmy (weekday first).
        "numericWeekdayFirst": bool(getattr(dp, "_ddmy", False)),
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
    out = []
    for text in TYPED["_all"] + TYPED.get(lang, []):
        parsed = gramps_parse(dp, text)
        out.append({"text": text, "parsed": date_json(parsed) if parsed else None})
    return out


GRAMPS_ERRORS = {}


def gramps_display(dd, date):
    """dd.display(date), or None where Gramps itself raises -- e.g. Czech's
    inflected month formats hit KeyError 'X' in format_long_month for some
    date types. Counted per language and reported; tests skip these."""
    try:
        return dd.display(date)
    except Exception as exc:  # noqa: BLE001 -- recording Gramps' own failures
        key = f"{type(exc).__name__}: {exc}"
        GRAMPS_ERRORS[key] = GRAMPS_ERRORS.get(key, 0) + 1
        return None


def gramps_parse(dp, text):
    """dp.parse(text), or None where Gramps' parser itself raises (it only
    catches DateError -- Japanese "between 1850 and 1860" hits KeyError in
    _parse_calendar). Counted like gramps_display's; tests skip these."""
    try:
        return dp.parse(text)
    except Exception as exc:  # noqa: BLE001 -- recording Gramps' own failures
        key = f"parse {type(exc).__name__}: {exc}"
        GRAMPS_ERRORS[key] = GRAMPS_ERRORS.get(key, 0) + 1
        return None


def vectors(loc):
    dd, dp = loc.date_displayer, loc.date_parser
    result = []
    for date in sample_dates():
        shown = []
        for index in range(len(dd.formats)):
            dd.set_format(index)
            text = gramps_display(dd, date)
            if text is None:
                shown.append(None)  # Gramps itself raises here -- see gramps_display
                continue
            parsed = gramps_parse(dp, text)
            shown.append({"text": text, "parsed": date_json(parsed) if parsed else None,
                          "grampsRoundTrips": bool(parsed and parsed.is_equal(date)) and not collided(date)})
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
                text = gramps_display(dd, date)
                if text is None:
                    shown.append(None)  # Gramps itself raises here -- see gramps_display
                    continue
                parsed_date = gramps_parse(dp, text)
                if parsed_date is None:
                    shown.append([text, None])  # Gramps' parser raises -- see gramps_parse
                    continue
                parsed = compact(parsed_date)
                same = structured(parsed) == structured(original) and not collided(date)
                shown.append(text if same else [text, parsed])
            rows.append([original, shown])
        out.append({"name": name, "formats": list(formats), "dates": rows})
    return out


TS_HEADER = """// GENERATED by scripts/generate_gramps_locales.py from Gramps' live
// date displayer/parser for "{lang}" -- do not edit by hand; re-run the
// script. Layouts: locales/index.ts (base ones unless listed there).
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


def all_languages():
    """English plus every language Gramps ships (po/LINGUAS -- the catalogs
    its build compiles and installs; other po/*.po files exist but aren't
    shipped)."""
    po_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__import__("gramps").__file__))), "po")
    with open(os.path.join(po_dir, "LINGUAS"), encoding="utf-8") as f:
        linguas = [word for line in f if not line.startswith("#") for word in line.split()]
    return ["en"] + linguas


def check_catalog(lang, loc):
    """Translations must actually load (a GrampsLocale made before the
    datehandler import, or without compiled catalogs, silently comes out
    English). Checked by the catalog file rather than by month names: many
    of Gramps' languages don't translate dates, and really do show English
    month names."""
    if lang.startswith("en"):
        return
    mo = os.path.join(loc.localedir or "", lang, "LC_MESSAGES", "gramps.mo")
    if not os.path.exists(mo):
        raise SystemExit(f"{lang}: no compiled catalog at {mo}")


def write_gz_json(path, data):
    import gzip
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def write_manifest():
    """locales/available.generated.ts: every generated language and a loader
    for each (a static import() per file, which bundlers split into its own
    chunk), so the package can list and load languages on demand. English
    is built in (locales/en.ts), so not listed."""
    langs = sorted(f[: -len(".generated.ts")] for f in os.listdir(os.path.join(SRC, "locales"))
                   if f.endswith(".generated.ts") and f not in ("available.generated.ts", "en.generated.ts"))
    lines = ["// GENERATED by scripts/generate_gramps_locales.py -- every language with a",
             "// <code>.generated.ts here, each loaded on demand (English is built in).", "",
             'import type { GrampsStrings } from "./fromGramps";', "",
             "export const LOCALE_LOADERS: Readonly<Record<string, () => Promise<{ strings: GrampsStrings }>>> = {"]
    lines += [f'  {json.dumps(lang)}: () => import("./{lang}.generated"),' for lang in langs]
    lines += ["};", ""]
    with open(os.path.join(SRC, "locales", "available.generated.ts"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main(langs, strings_only=False, jobs=None):
    """Each language in its own process: Gramps' parser keeps month tables
    and patterns in class attributes, so one language's leak into the next
    in a shared process (Serbian typed input read with another language's
    words)."""
    os.makedirs(os.path.join(SRC, "__tests__", "fixtures"), exist_ok=True)
    flags = ["--strings-only"] if strings_only else []
    failed = []
    with ThreadPoolExecutor(max_workers=jobs or os.cpu_count()) as pool:
        runs = {lang: pool.submit(subprocess.run, [sys.executable, __file__, "--one", lang, *flags],
                                  capture_output=True, text=True) for lang in langs}
        for lang, run in runs.items():
            result = run.result()
            print(result.stdout, end="", flush=True)
            if result.returncode:
                failed.append(lang)
                print(f"{lang}: FAILED\n{result.stderr}", file=sys.stderr, flush=True)
    write_manifest()
    if failed:
        sys.exit(f"failed: {' '.join(failed)}")


def generate(lang, strings_only=False):
    sets = None if strings_only else gramps_test_sets()
    loc = GrampsLocale(lang=lang)
    check_catalog(lang, loc)
    align_parser_numeric_order(lang, loc)
    data = strings(lang, loc)
    ts = TS_HEADER.format(lang=lang)
    ts += f"export const strings = {json.dumps(data, ensure_ascii=False, indent=2)} as const;\n"
    with open(os.path.join(SRC, "locales", f"{lang}.generated.ts"), "w", encoding="utf-8") as f:
        f.write(ts)
    if strings_only:
        print(f"{lang}: strings", flush=True)
        return
    fixtures = os.path.join(SRC, "__tests__", "fixtures")
    write_gz_json(os.path.join(fixtures, f"gramps-{lang}.json.gz"),
                  {"lang": lang, "formatNames": data["formatNames"], "vectors": vectors(loc), "typed": typed_vectors(lang, loc)})
    write_gz_json(os.path.join(fixtures, f"gramps-tests-{lang}.json.gz"), {"lang": lang, "sets": test_set_vectors(loc, sets)})
    errors = f", Gramps raised {dict(GRAMPS_ERRORS)}" if GRAMPS_ERRORS else ""
    GRAMPS_ERRORS.clear()
    print(f"{lang}: {len(data['formatNames'])} formats, templates {data['templates'][1]['range']!r}{errors}", flush=True)


if __name__ == "__main__":
    # --strings-only: rewrite locales/*.generated.ts without the (slow) fixtures.
    # --one LANG: generate a single language in this process (main's workers).
    strings_only = "--strings-only" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--strings-only"]
    if args[:1] == ["--one"]:
        generate(args[1], strings_only)
    else:
        main(args or all_languages(), strings_only)
