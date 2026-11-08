"""Behavioral-equivalence tests for the Event and Place rules with values
that only those types have (`typeSpecificPresets` in gqlFilterPresets.ts),
against the real gramps-core rules in rules/event/ and rules/place/. The
rules they share with other types are in test_detail_presets.py.

Values are filled in by helpers.fill(), which mirrors goqlFilterCombiner
.ts's fillParam(); app/src/store/__tests__/goqlFilterParamTypes.test.ts
checks the TypeScript side renders the same strings.
"""

import pytest
from gramps.gen.datehandler import parser as date_parser
from gramps.gen.filters.rules import event as event_rules
from gramps.gen.filters.rules import place as place_rules

from helpers import compare, fill, goql_matching_handles, objects


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
