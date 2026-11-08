"""Behavioral-equivalence tests for the Family rules with values
(`familyMemberPresets()` and the Family part of `typeSpecificPresets` in
gqlFilterPresets.ts), against the real gramps-core rules in rules/family/.
The rules Families share with other types are in test_detail_presets.py.
"""

import pytest
from gramps.gen.datehandler import parser as date_parser
from gramps.gen.filters.rules import family as family_rules

from helpers import compare, compare_plain, fill, goql_matching_handles, objects


def name_args(given="", surname=""):
    """HasNameOf's 11 fields, with only the given name or surname set."""
    return [given, surname] + [""] * 9


MEMBER_RULES = {
    "father": (family_rules.FatherHasNameOf, family_rules.FatherHasIdOf),
    "mother": (family_rules.MotherHasNameOf, family_rules.MotherHasIdOf),
    "child": (family_rules.ChildHasNameOf, family_rules.ChildHasIdOf),
}


@pytest.mark.parametrize("who", ["father", "mother", "child"])
@pytest.mark.parametrize("text", ["ANNA", "lew", "an", "zzz"])
def test_member_given_name(db, gramps_user, preset_by_id, who, text):
    compare(
        db, "Family", fill(preset_by_id[f"family-{who}-given-name-contains"], text=text),
        MEMBER_RULES[who][0](name_args(given=text)), gramps_user, expect_some=(text != "zzz"),
    )


@pytest.mark.parametrize("who", ["father", "mother", "child"])
@pytest.mark.parametrize("text", ["GARNER", "son", "zzz"])
def test_member_surname(db, gramps_user, preset_by_id, who, text):
    compare(
        db, "Family", fill(preset_by_id[f"family-{who}-surname-contains"], text=text),
        MEMBER_RULES[who][0](name_args(surname=text)), gramps_user, expect_some=(text != "zzz"),
    )


@pytest.mark.parametrize("who", ["father", "mother", "child"])
def test_member_id_matches(db, gramps_user, preset_by_id, who):
    pattern = r"i00\d4"
    compare(
        db, "Family", fill(preset_by_id[f"family-{who}-id-matches"], pattern=pattern),
        MEMBER_RULES[who][1]([pattern], use_regex=True), gramps_user,
    )


@pytest.mark.parametrize("rel_type", ["Married", "Unmarried", "Unknown", "Living Apart"])
def test_relationship_type(db, gramps_user, preset_by_id, rel_type):
    """Married is value 0 in FamilyRelType, whose Custom is 4 -- the one
    type table where 0 isn't Custom. Living Apart is a custom name."""
    compare(
        db, "Family", fill(preset_by_id["family-relationship-type"], relType=rel_type),
        family_rules.HasRelType([rel_type]), gramps_user, expect_some=(rel_type == "Married"),
    )


@pytest.mark.parametrize("op,count", [(">", 3), ("<", 1), ("==", 2)])
def test_child_count(db, preset_by_id, op, count):
    """gramps-core has no Family rule for this; checked against the
    family's own child list."""
    check = {">": lambda n: n > count, "<": lambda n: n < count, "==": lambda n: n == count}[op]
    compare_plain(
        db, "Family", fill(preset_by_id["family-child-count"], comparison=op, count=count),
        lambda f: check(len(f.child_ref_list)),
    )


@pytest.mark.parametrize("event_type", ["Marriage", "Divorce", "LVG"])
def test_event_type(db, gramps_user, preset_by_id, event_type):
    compare(
        db, "Family", fill(preset_by_id["family-event-type"], eventType=event_type),
        family_rules.HasEvent([event_type, "", "", "", ""]), gramps_user, expect_some=(event_type == "Marriage"),
    )


def test_event_date_between(db, preset_by_id):
    """A plain sortval range on an event of that type, not gramps-core's
    fuzzy Date.match() (see test_event_date_between)."""
    start, end = "1 Jan 1850", "31 Dec 1900"
    lo, hi = date_parser.parse(start), date_parser.parse(end)

    def check(family):
        for ref in family.event_ref_list:
            e = db.get_event_from_handle(ref.ref)
            if e.type.xml_str() == "Marriage" and e.date.sortval != 0 and lo.sortval <= e.date.sortval <= hi.sortval:
                return True
        return False

    compare_plain(
        db, "Family",
        fill(preset_by_id["family-event-date-between"], eventType="Marriage", startDate=start, endDate=end), check,
    )


@pytest.mark.parametrize("text", ["SAN ", "lock", "zzz"])
def test_event_place_contains(db, preset_by_id, text):
    """gramps-core's HasEvent matches the place's full displayed title;
    this rule matches its own name (see the preset's notes)."""

    def check(family):
        for ref in family.event_ref_list:
            e = db.get_event_from_handle(ref.ref)
            if e.place and text.lower() in db.get_place_from_handle(e.place).name.value.lower():
                return True
        return False

    compare_plain(
        db, "Family", fill(preset_by_id["family-event-place-contains"], text=text), check,
        expect_some=(text != "zzz"),
    )


@pytest.mark.parametrize("text", ["MARRIAGE OF adkins", "zzz"])
def test_event_description_contains(db, gramps_user, preset_by_id, text):
    compare(
        db, "Family", fill(preset_by_id["family-event-description-contains"], text=text),
        family_rules.HasEvent(["", "", "", text, ""]), gramps_user, expect_some=(text != "zzz"),
    )


@pytest.mark.parametrize("attr,value", [("Number of Children", "8"), ("Number of Children", "9"), ("Age", "")])
def test_attribute(db, gramps_user, preset_by_id, attr, value):
    compare(
        db, "Family", fill(preset_by_id["family-attribute"], attributeType=attr, value=value),
        family_rules.HasAttribute([attr, value]), gramps_user, expect_some=(value == "8"),
    )


def test_source_id_is(db, gramps_user, preset_by_id):
    matched = 0
    for source in db.iter_sources():
        gid = source.gramps_id
        matched += compare(
            db, "Family", fill(preset_by_id["family-source-id-is"], id=gid), family_rules.HasSourceOf([gid]),
            gramps_user, expect_some=False,
        )
    assert matched


def test_citation_page_contains(db, gramps_user, preset_by_id):
    compare(
        db, "Family", fill(preset_by_id["family-citation-page-contains"], text="PAGE"),
        family_rules.HasCitation(["PAGE", "", ""]), gramps_user,
    )


@pytest.mark.parametrize("op,word,count", [(">", "greater than", 0), ("==", "equal to", 0), ("<", "less than", 2)])
def test_lds_count(db, gramps_user, preset_by_id, op, word, count):
    compare(
        db, "Family", fill(preset_by_id["family-lds-count"], comparison=op, count=count),
        family_rules.HasLDS([str(count), word]), gramps_user,
    )
