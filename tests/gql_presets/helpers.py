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
