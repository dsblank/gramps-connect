"""Shared comparison logic for the GOQL built-in preset suite.

Every test in this directory follows the same shape: compile a preset's
`expr` (`gramps_object_query_language.query_lang.compile_expr`), evaluate
it directly against every object of that type in the shared `db` fixture
(`gramps_object_query_language.evaluator.evaluate_where` -- a pure-Python
AST walk against real Gramps objects, no SQL/server involved at all), and
compare the resulting handle set against what the *real* gramps-core
`Rule` subclass returns for the same objects. `assert_goql_matches_rule`
is that comparison, parameterized by which object type to iterate.
"""

from typing import Callable, Iterable

from gramps_object_query_language.evaluator import evaluate_where
from gramps_object_query_language.query_lang import compile_expr


def goql_matching_handles(db, namespace: str, expr: str, objects: Iterable) -> set:
    spec, where = compile_expr(namespace, expr)
    return {obj.handle for obj in objects if evaluate_where(db, obj, where, spec)}


def rule_matching_handles(db, rule, objects: Iterable) -> set:
    return {obj.handle for obj in objects if rule.apply_to_one(db, obj)}


def assert_goql_matches_rule(
    db,
    namespace: str,
    expr: str,
    rule,
    objects: Iterable,
    *,
    user=None,
) -> None:
    """Asserts the GOQL `expr` (compiled for `namespace`) selects exactly
    the same handles, out of `objects`, as the real gramps-core `rule`
    does. `objects` is passed in (rather than re-derived from `db` here)
    so a caller can hand this the same `list(db.iter_people())`-shaped
    iterable it also uses to build any test-specific expected set (see
    `test_families_incomplete_events`), without walking the database
    twice with two different iterators that might not agree on order/
    identity.
    """
    objects = list(objects)
    if hasattr(rule, "prepare"):
        rule.prepare(db, user)
    expected = rule_matching_handles(db, rule, objects)
    actual = goql_matching_handles(db, namespace, expr, objects)
    missing = expected - actual
    extra = actual - expected
    assert not missing and not extra, (
        f"GOQL {expr!r} vs {type(rule).__name__}: "
        f"{len(missing)} missing (matched by rule, not GOQL), "
        f"{len(extra)} extra (matched by GOQL, not rule)"
    )


# -- Rules with values (gqlFilterPresets.ts's detailPresets() and
# typeSpecificPresets) --------------------------------------------------------

from gramps.gen.lib import AttributeType, EventType, FamilyRelType, NoteType, PlaceType, RepositoryType, SrcAttributeType

ITER = {
    "Family": "iter_families", "Event": "iter_events", "Place": "iter_places", "Repository": "iter_repositories", "Source": "iter_sources",
    "Citation": "iter_citations", "Media": "iter_media", "Note": "iter_notes",
}

TYPE_TABLES = {
    "EventType": EventType, "PlaceType": PlaceType, "NoteType": NoteType, "AttributeType": AttributeType,
    "SrcAttributeType": SrcAttributeType, "RepositoryType": RepositoryType, "FamilyRelType": FamilyRelType,
}


def fill(preset, **values):
    """goqlFilterCombiner.ts's fillParam(), for every param type. Values
    for "datetime" are passed already converted to seconds."""
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
        else:  # integer, choice, datetime
            out = str(raw)
        expr = expr.replace("{" + param["name"] + "}", out)
    return expr


def type_condition(param, name):
    table = TYPE_TABLES[param["table"]]
    value = next((m[0] for m in table._DATAMAP if m[2] == name), None)
    field = param["field"]
    if value is not None and value != table._CUSTOM:
        return f"({field}.value == {value})"
    return f"({field}.value == {table._CUSTOM} and {field}.string == '{name}')"


def objects(db, ns):
    return list(getattr(db, ITER[ns])())


def compare(db, ns, expr, rule, user, *, expect_some=True):
    """The GOQL expr and the gramps-core rule pick the same objects -- and,
    unless `expect_some` is off (the fixture has nothing to match), at
    least one, so a case can't pass by both sides matching nothing."""
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


def compare_plain(db, ns, expr, check, *, expect_some=True):
    """Like compare(), against a plain per-object check, for rules
    gramps-core lacks or gets wrong."""
    objs = objects(db, ns)
    expected = {o.handle for o in objs if check(o)}
    actual = goql_matching_handles(db, ns, expr, objs)
    assert actual == expected, f"{expr!r}: {len(expected - actual)} missing, {len(actual - expected)} extra"
    if expect_some:
        assert expected, f"{expr!r}: nothing in the fixture to match; the case proves nothing"
