"""Behavioral-equivalence tests for every `supported: true` built-in
preset in `gqlFilterPresets.ts`, against the real gramps-core `Rule`
class it's meant to port. See this directory's README.md for the
mechanism and why it needed to exist (a real bug -- `has-nickname`'s
`nick_name` field doesn't exist -- prompted this whole suite).

Each test is deliberately its own small function, naming its own
preset id and gramps-core `Rule` class, rather than one generic loop
over every preset -- a failure names exactly which one broke and why,
and a handful of presets (the year-range pair, the Family-namespace
reformulation, the `supported: false` set) each need their own slightly
different comparison, which a single generic loop can't express
cleanly anyway.
"""

from gramps.gen.filters.rules.person import (
    Disconnected,
    HasAddress,
    HasAlternateName,
    HasAssociation,
    HasNickname,
    HasNote,
    HasOtherGender,
    HasSourceCount,
    HasTag,
    HasUnknownGender,
    HaveAltFamilies,
    HaveChildren,
    HavePhotos,
    IncompleteNames,
    IsFemale,
    IsMale,
    MissingParent,
    MultipleMarriages,
    NeverMarried,
    NoBirthdate,
    NoDeathdate,
    PeoplePrivate,
    PeoplePublic,
    PersonWithIncompleteEvent,
)
from gramps.gen.datehandler import parser as date_parser
from gramps_object_query_language.query_lang import QueryError, QueryLangError, compile_expr
import pytest

from helpers import assert_goql_matches_rule, goql_matching_handles


def person_expr(preset_by_id, preset_id: str) -> str:
    return preset_by_id[preset_id]["expr"]


def test_females(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "females"), IsFemale([]), db.iter_people(), user=gramps_user,
    )


def test_males(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "males"), IsMale([]), db.iter_people(), user=gramps_user,
    )


def test_unknown_gender(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "unknown-gender"), HasUnknownGender([]), db.iter_people(),
        user=gramps_user,
    )


def test_has_other_gender(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-other-gender"), HasOtherGender([]), db.iter_people(),
        user=gramps_user,
    )


def test_has_nickname(db, gramps_user, preset_by_id):
    """The bug that started this whole suite: the old expr referenced
    `primary_name.nick_name`, which doesn't exist (the real field is
    `nick`) -- a QueryError, not a silent mismatch. Confirms the fix.
    """
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-nickname"), HasNickname([]), db.iter_people(),
        user=gramps_user,
    )


def test_has_nickname_old_field_name_is_rejected():
    """The exact bug report this whole suite exists to catch: asserts
    the *old*, wrong expr fails to compile, not just that the new one
    works -- a regression guard on the bug itself, not only its fix.
    """
    with pytest.raises(QueryError, match="nick_name"):
        compile_expr("Person", "primary_name.nick_name != ''")


def test_has_children(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-children"), HaveChildren([]), db.iter_people(),
        user=gramps_user,
    )


def test_has_alternate_name(db, gramps_user, preset_by_id):
    """The real rule is exactly bool(person.alternate_names) -- a plain
    count, no per-name field condition -- so len() alone (no any()) is a
    faithful translation. Closed via len(path) once that shipped -- see
    gramps-object-query-language's DISABLED-FILTER-RULES.md.
    """
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-alternate-name"), HasAlternateName([]),
        db.iter_people(), user=gramps_user,
    )


def test_has_addresses(db, gramps_user, preset_by_id):
    """The real rule is parameterized (a count and a </==/> comparison);
    this quick-pick preset only offers the simple 'has at least one' case,
    matched here against the rule's own equivalent parameterization.
    """
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-addresses"), HasAddress(["0", "greater than"]),
        db.iter_people(), user=gramps_user,
    )


def test_adopted(db, gramps_user, preset_by_id):
    """HaveAltFamilies finds, for each of a person's parent families, the
    ChildRef entry whose `ref` is this person's own handle, then checks
    that entry's own frel/mrel against ChildRefType.ADOPTED -- a field on
    the join/link itself, not on Person or Family. Closed by child_refs, a
    self-linked Collection built for exactly this shape -- see
    gramps-object-query-language's DISABLED-FILTER-RULES.md.
    """
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "adopted"), HaveAltFamilies([]),
        db.iter_people(), user=gramps_user,
    )


def test_incomplete_names(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "incomplete-names"), IncompleteNames([]), db.iter_people(),
        user=gramps_user,
    )


def test_no_marriage_records(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "no-marriage-records"), NeverMarried([]), db.iter_people(),
        user=gramps_user,
    )


def test_multiple_marriages(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "multiple-marriages"), MultipleMarriages([]), db.iter_people(),
        user=gramps_user,
    )


def test_no_birth_date(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "no-birth-date"), NoBirthdate([]), db.iter_people(),
        user=gramps_user,
    )


def test_no_death_date(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "no-death-date"), NoDeathdate([]), db.iter_people(),
        user=gramps_user,
    )


def test_incomplete_events(db, gramps_user, preset_by_id):
    """The other real bug: `place is None` never matches, since an
    unset Event.place is `''` at runtime, not `None`. The old expr
    matched zero rows; this asserts the fixed one matches all 745.
    """
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "incomplete-events"), PersonWithIncompleteEvent([]),
        db.iter_people(), user=gramps_user,
    )


def test_missing_parents(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "missing-parents"), MissingParent([]), db.iter_people(),
        user=gramps_user,
    )


def test_disconnected(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "disconnected"), Disconnected([]), db.iter_people(),
        user=gramps_user,
    )


def test_has_media(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-media"), HavePhotos(["0", "greater than"]), db.iter_people(),
        user=gramps_user,
    )


def test_has_notes(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-notes"), HasNote(["0", "greater than"]), db.iter_people(),
        user=gramps_user,
    )


def test_has_sources(db, gramps_user, preset_by_id):
    """gramps-core's HasSourceCount literally counts citations (its own
    source comment says so) -- `len([c for c in citations]) > 0` is the
    direct translation, not an approximation.
    """
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-sources"), HasSourceCount(["0", "greater than"]),
        db.iter_people(), user=gramps_user,
    )


def test_has_associations(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "has-associations"), HasAssociation(["0", "greater than"]),
        db.iter_people(), user=gramps_user,
    )


def test_private(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "private"), PeoplePrivate([]), db.iter_people(), user=gramps_user,
    )


def test_not_private(db, gramps_user, preset_by_id):
    assert_goql_matches_rule(
        db, "Person", person_expr(preset_by_id, "not-private"), PeoplePublic([]), db.iter_people(),
        user=gramps_user,
    )


def test_has_tag(db, gramps_user, preset_by_id):
    """`has-tag` takes the tag name as a user-filled value (originally
    one hardcoded preset per fixed tag name -- replaced since a tree's
    actual tags are user-defined, not that fixed list) -- fills in the
    shipped preset's own `{tagName}` placeholder exactly the way the
    UI's params substitution does (goqlFilterCombiner.ts's fillParams()),
    against whatever tag genuinely exists in the fixture.
    """
    tags = list(db.iter_tags())
    assert tags, "example.gramps fixture has no tags at all -- can't exercise the tag mechanism"
    tag_name = tags[0].name
    expr = preset_by_id["has-tag"]["expr"].replace("{tagName}", tag_name)
    assert_goql_matches_rule(db, "Person", expr, HasTag([tag_name]), db.iter_people(), user=gramps_user)


def test_birth_year_between(db, preset_by_id):
    """No single gramps-core Rule matches a date range 1:1 (HasBirth
    takes one free-form date expression, matched via `event.date.match()`,
    plus place/description this preset intentionally doesn't cover --
    see its own `notes`), so "expected" here is computed directly from
    birth_ref_index/date.sortval, matching exactly what the expr itself
    claims to do. Uses full date strings (not bare years), parsed via
    Gramps' own date parser -- proving the preset's bounds accept any
    Gramps date expression, not just a year.
    """
    start_date, end_date = "12 May 1800", "31 Dec 1850"
    lo, hi = date_parser.parse(start_date), date_parser.parse(end_date)

    expected = set()
    for p in db.iter_people():
        if not (0 <= p.birth_ref_index < len(p.event_ref_list)):
            continue
        event = db.get_event_from_handle(p.event_ref_list[p.birth_ref_index].ref)
        if event and event.date.sortval != 0 and lo.sortval <= event.date.sortval <= hi.sortval:
            expected.add(p.handle)

    expr = (
        preset_by_id["birth-year-between"]["expr"]
        .replace("{startDate}", start_date)
        .replace("{endDate}", end_date)
    )
    actual = goql_matching_handles(db, "Person", expr, db.iter_people())
    assert actual == expected


def test_death_year_between(db, preset_by_id):
    start_date, end_date = "12 May 1800", "31 Dec 1850"
    lo, hi = date_parser.parse(start_date), date_parser.parse(end_date)

    expected = set()
    for p in db.iter_people():
        if not (0 <= p.death_ref_index < len(p.event_ref_list)):
            continue
        event = db.get_event_from_handle(p.event_ref_list[p.death_ref_index].ref)
        if event and event.date.sortval != 0 and lo.sortval <= event.date.sortval <= hi.sortval:
            expected.add(p.handle)

    expr = (
        preset_by_id["death-year-between"]["expr"]
        .replace("{startDate}", start_date)
        .replace("{endDate}", end_date)
    )
    actual = goql_matching_handles(db, "Person", expr, db.iter_people())
    assert actual == expected


def test_families_incomplete_events(db, preset_by_id):
    """`FamilyWithIncompleteEvent` is a *Person* rule (walks
    person.family_list's own families), but this preset is a deliberate
    Family-namespace reformulation -- so "expected" is derived directly
    from each Family's own event_ref_list (matching the real rule's own
    inner loop exactly, not the outer per-person loop, which -- verified
    live while planning this -- over-counts if done naively per person).
    """
    expected = set()
    for family in db.iter_families():
        for event_ref in family.event_ref_list:
            if not event_ref:
                continue
            event = db.get_event_from_handle(event_ref.ref)
            if event and (not event.place or not event.date):
                expected.add(family.handle)
                break

    expr = preset_by_id["families-incomplete-events"]["expr"]
    actual = goql_matching_handles(db, "Family", expr, db.iter_families())
    assert actual == expected


@pytest.mark.parametrize(
    ("preset_id", "namespace", "expr_if_it_existed"),
    [
        # Each `expr_if_it_existed` is the natural GOQL a user would try
        # to express the preset's real gramps-core semantics -- proving
        # the *specific* gap named in the preset's own `notes`, not just
        # that some arbitrary nonsense string fails to compile. If GOQL
        # ever gains the missing capability, one of these starts *not*
        # raising, and this test fails -- forcing a deliberate update
        # (flip `supported` to `true`, fill in the real `expr`) instead
        # of the gap silently going stale.
        #
        # Empty for now -- the registry's last three `supported: false`
        # entries (has-alternate-name/has-addresses/adopted) were closed by
        # len()/child_refs (see gramps-object-query-language's
        # DISABLED-FILTER-RULES.md); test_has_alternate_name/
        # test_has_addresses/test_adopted above now cover them as ordinary
        # behavioral-equivalence tests instead. The mechanism stays for
        # whenever a future GOQL gap adds a new `supported: false` preset.
    ],
)
def test_unsupported_preset_genuinely_cannot_compile(preset_id, namespace, expr_if_it_existed, preset_by_id):
    preset = preset_by_id[preset_id]
    assert preset["supported"] is False
    assert preset["notes"], f"{preset_id} is unsupported but has no notes explaining why"
    with pytest.raises((QueryError, QueryLangError)):
        compile_expr(namespace, expr_if_it_existed)
