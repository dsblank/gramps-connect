"""Behavioral-equivalence tests for the Event and Place presets with values
(`detailPresets()` and `typeSpecificPresets` in gqlFilterPresets.ts),
against the real gramps-core rules in rules/event/ and rules/place/.

Values are filled in the way goqlFilterCombiner.ts's fillParam() does it;
`fill()` below mirrors that, and app/src/store/__tests__/
goqlFilterCombiner.test.ts checks the TypeScript side renders the same
strings. Every case also asserts the rule matched something, where the
fixture has anything to match, so a test can't pass by both sides
matching nothing.
"""

import time

import pytest
from gramps.gen.datehandler import parser as date_parser
from gramps.gen.filters.rules import event as event_rules
from gramps.gen.filters.rules import place as place_rules
from gramps.gen.lib import AttributeType, EventType, NoteType, PlaceType

from helpers import goql_matching_handles, rule_matching_handles

RULES = {"Event": event_rules, "Place": place_rules}
ITER = {"Event": "iter_events", "Place": "iter_places"}


def fill(preset, **values):
    """goqlFilterCombiner.ts's fillParam(), for the param types used here."""
    expr = preset["expr"]
    for param in preset.get("params", []):
        raw = values[param["name"]]
        kind = param["type"]
        if kind == "string":
            out = raw.replace("'", "").replace("\\", "")
        elif kind == "regex":
            out = raw.replace("'", "").replace("\\", "\\\\")
        elif kind == "gramps-type":
            out = type_condition(param, raw)
        else:  # integer, choice, datetime (already seconds)
            out = str(raw)
        expr = expr.replace("{" + param["name"] + "}", out)
    return expr


def type_condition(param, name):
    table = {"EventType": EventType, "PlaceType": PlaceType, "NoteType": NoteType, "AttributeType": AttributeType}[param["table"]]
    value = next((m[0] for m in table._DATAMAP if m[2] == name), None)
    field = param["field"]
    if value not in (None, 0):
        return f"({field}.value == {value})"
    return f"({field}.value == 0 and {field}.string == '{name}')"


def objects(db, ns):
    return list(getattr(db, ITER[ns])())


def compare(db, ns, expr, rule, user, *, expect_some=True):
    objs = objects(db, ns)
    if hasattr(rule, "requestprepare"):
        rule.requestprepare(db, user)
    expected = rule_matching_handles(db, rule, objs)
    actual = goql_matching_handles(db, ns, expr, objs)
    assert actual == expected, (
        f"{expr!r} vs {type(rule).__name__}: {len(expected - actual)} missing, {len(actual - expected)} extra"
    )
    if expect_some:
        assert expected, f"{type(rule).__name__} matched nothing in the fixture; the case proves nothing"
    return len(expected)


NAMESPACES = ["Event", "Place"]


@pytest.mark.parametrize("ns", NAMESPACES)
def test_id_is(db, gramps_user, preset_by_id, ns):
    gid = objects(db, ns)[5].gramps_id
    p = preset_by_id[f"{ns.lower()}-id-is"]
    compare(db, ns, fill(p, id=gid), RULES[ns].HasIdOf([gid]), gramps_user)


@pytest.mark.parametrize("ns,pattern", [("Event", r"^e\d{3}1$"), ("Place", r"P00[0-2]\d")])
def test_id_matches(db, gramps_user, preset_by_id, ns, pattern):
    """Lower-case `e` checks the case-insensitivity; `\\d` checks that a
    backslash survives fill()'s escaping."""
    p = preset_by_id[f"{ns.lower()}-id-matches"]
    compare(db, ns, fill(p, pattern=pattern), RULES[ns].RegExpIdOf([pattern], use_regex=True), gramps_user)


@pytest.mark.parametrize("ns", NAMESPACES)
def test_changed_since(db, gramps_user, preset_by_id, ns):
    changes = sorted({o.change for o in objects(db, ns)})
    since = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(changes[len(changes) // 2]))
    seconds = int(time.mktime(time.strptime(since, "%Y-%m-%d %H:%M:%S")))
    p = preset_by_id[f"{ns.lower()}-changed-since"]
    compare(db, ns, fill(p, since=seconds), RULES[ns].ChangedSince([since, ""]), gramps_user)


@pytest.mark.parametrize("ns", NAMESPACES)
@pytest.mark.parametrize("op,word", [(">", "greater than"), ("<", "less than"), ("==", "equal to")])
@pytest.mark.parametrize("count", [1, 3])
def test_reference_count(db, gramps_user, preset_by_id, ns, op, word, count):
    p = preset_by_id[f"{ns.lower()}-reference-count"]
    compare(
        db, ns, fill(p, comparison=op, count=count), RULES[ns].HasReferenceCountOf([word, str(count)]), gramps_user,
        expect_some=False,
    )


@pytest.mark.parametrize("ns", NAMESPACES)
def test_notes_contain(db, gramps_user, preset_by_id, ns):
    p = preset_by_id[f"{ns.lower()}-notes-contain"]
    compare(
        db, ns, fill(p, text="FIND OUT"), RULES[ns].HasNoteMatchingSubstringOf(["FIND OUT"]), gramps_user,
        expect_some=(ns == "Event"),
    )


@pytest.mark.parametrize("ns", NAMESPACES)
def test_notes_match(db, gramps_user, preset_by_id, ns):
    pattern = r"how\s+did"
    p = preset_by_id[f"{ns.lower()}-notes-match"]
    compare(
        db, ns, fill(p, pattern=pattern), RULES[ns].HasNoteRegexp([pattern], use_regex=True), gramps_user,
        expect_some=(ns == "Event"),
    )


@pytest.mark.parametrize("ns", NAMESPACES)
@pytest.mark.parametrize("note_type", ["Event Note", "General", "My Custom Type"])
def test_note_type(db, gramps_user, preset_by_id, ns, note_type):
    p = preset_by_id[f"{ns.lower()}-note-type"]
    compare(
        db, ns, fill(p, noteType=note_type), RULES[ns].HasNoteType([note_type]), gramps_user,
        expect_some=(ns == "Event" and note_type == "Event Note"),
    )


@pytest.mark.parametrize("ns", NAMESPACES)
@pytest.mark.parametrize("level", [0, 2, 4])
def test_citation_confidence(db, gramps_user, preset_by_id, ns, level):
    p = preset_by_id[f"{ns.lower()}-citation-confidence"]
    compare(
        db, ns, fill(p, level=level), RULES[ns].MatchesSourceConfidence([str(level)]), gramps_user,
        expect_some=False,
    )


@pytest.mark.parametrize("event_type", ["Birth", "Burial", "LVG", "Stillbirth"])
def test_event_type(db, gramps_user, preset_by_id, event_type):
    """LVG is a custom type in the fixture (value 0 + string); Stillbirth
    is a standard type with no events."""
    compare(
        db, "Event", fill(preset_by_id["event-type"], eventType=event_type), event_rules.HasType([event_type]),
        gramps_user, expect_some=(event_type != "Stillbirth"),
    )


def test_event_date_between(db, preset_by_id):
    """Like test_birth_year_between: gramps-core's HasData matches one
    fuzzy date, so the expected set is the plain sortval range the preset
    claims, not a gramps-core rule."""
    start, end = "1 Jan 1850", "31 Dec 1860"
    lo, hi = date_parser.parse(start), date_parser.parse(end)
    events = objects(db, "Event")
    expected = {e.handle for e in events if e.date.sortval != 0 and lo.sortval <= e.date.sortval <= hi.sortval}
    actual = goql_matching_handles(
        db, "Event", fill(preset_by_id["event-date-between"], startDate=start, endDate=end), events,
    )
    assert actual == expected and expected


def test_event_description_contains(db, gramps_user, preset_by_id):
    compare(
        db, "Event", fill(preset_by_id["event-description-contains"], text="birth of war"),
        event_rules.HasData(["", "", "", "birth of war"]), gramps_user,
    )


@pytest.mark.parametrize("attr,value", [("Time", "10:00"), ("Cause", "laugh"), ("Cause", "tears"), ("Age", "1")])
def test_event_attribute(db, gramps_user, preset_by_id, attr, value):
    p = preset_by_id["event-attribute"]
    compare(
        db, "Event", fill(p, attributeType=attr, value=value), event_rules.HasAttribute([attr, value]), gramps_user,
        expect_some=(value in ("10:00", "laugh")),
    )


@pytest.mark.parametrize("place_type", ["City", "County", "Unknown", "Village"])
def test_place_type(db, gramps_user, preset_by_id, place_type):
    compare(
        db, "Place", fill(preset_by_id["place-type"], placeType=place_type), place_rules.HasData(["", place_type, ""]),
        gramps_user, expect_some=(place_type != "Village"),
    )


@pytest.mark.parametrize("text", ["ville", "SAN ", "zzz"])
def test_place_name_contains(db, gramps_user, preset_by_id, text):
    compare(
        db, "Place", fill(preset_by_id["place-name-contains"], text=text), place_rules.HasData([text, "", ""]),
        gramps_user, expect_some=(text != "zzz"),
    )


def test_place_code_contains(db, gramps_user, preset_by_id):
    """The fixture has no place codes, so this only proves the rule
    compiles and matches nothing it shouldn't."""
    compare(
        db, "Place", fill(preset_by_id["place-code-contains"], text="12"), place_rules.HasData(["", "", "12"]),
        gramps_user, expect_some=False,
    )


def test_place_no_coordinates(db, gramps_user, preset_by_id):
    compare(db, "Place", preset_by_id["place-no-coordinates"]["expr"], place_rules.HasNoLatOrLon([]), gramps_user)
