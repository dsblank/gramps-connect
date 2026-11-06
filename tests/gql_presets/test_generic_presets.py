"""Behavioral-equivalence tests for the *generated* presets in
`gqlFilterPresets.ts` (`GENERIC_RULE_TARGETS`): tags, privacy, and "has any
notes/media/sources/attributes", one copy per non-Person namespace (plus
Person's `has-attributes`).

Unlike `test_gql_presets.py`, this file is parametrized: every case here
is the same comparison against the same few base rules, so one function
per case would just repeat itself. Each case's pytest id is the preset id
(`event-has-notes`, ...), so a failure still names exactly which preset
broke.

Where gramps-core has a matching rule (rules/<type>/), the preset is
compared against it; its count-based HasNote/HasGallery/HasSourceCount
are run as `[0, "greater than"]`. Where it has none (any attribute at all;
has-notes on Repository/Media; "not private" outside Person), the preset
is compared against the object's own list/flag directly.
"""

import importlib

import pytest

from helpers import assert_goql_matches_rule, goql_matching_handles

ITERATORS = {
    "Person": "iter_people",
    "Family": "iter_families",
    "Event": "iter_events",
    "Place": "iter_places",
    "Repository": "iter_repositories",
    "Source": "iter_sources",
    "Citation": "iter_citations",
    "Media": "iter_media",
    "Note": "iter_notes",
}

RULE_MODULE = {ns: f"gramps.gen.filters.rules.{ns.lower()}" for ns in ITERATORS}

# What the object itself says, for presets with no gramps-core rule.
PLAIN_CHECKS = {
    "has-notes": lambda obj: len(obj.get_note_list()) > 0,
    "has-media": lambda obj: len(obj.get_media_list()) > 0,
    "has-sources": lambda obj: len(obj.get_citation_list()) > 0,
    "has-attributes": lambda obj: len(obj.get_attribute_list()) > 0,
    "private": lambda obj: bool(obj.private),
    "not-private": lambda obj: not obj.private,
}

COUNT_ARGS = ["0", "greater than"]


def _generated(presets):
    return [
        p for p in presets
        if p["namespace"] != "Person" and p["id"].startswith(p["namespace"].lower() + "-")
    ] + [p for p in presets if p["id"] == "has-attributes"]


def _kind(preset):
    """`event-has-notes` -> `has-notes`; Person's own ids are already bare."""
    prefix = preset["namespace"].lower() + "-"
    return preset["id"][len(prefix):] if preset["id"].startswith(prefix) else preset["id"]


def _load_presets():
    """The session `presets` fixture isn't available at collection time,
    so read the same export it reads, regenerating it the same way."""
    import json
    import os
    import subprocess
    from conftest import APP_DIR, PRESETS_JSON, PRESETS_SRC
    if not os.path.exists(PRESETS_JSON) or os.path.getmtime(PRESETS_SRC) > os.path.getmtime(PRESETS_JSON):
        subprocess.run(["npm", "run", "export:gql-presets"], cwd=APP_DIR, check=True)
    with open(PRESETS_JSON, encoding="utf-8") as f:
        return json.load(f)


def pytest_generate_tests(metafunc):
    for argname, want_tag in (("generic_preset", False), ("tag_preset", True)):
        if argname in metafunc.fixturenames:
            cases = [p for p in _generated(_load_presets()) if (_kind(p) == "has-tag") == want_tag]
            metafunc.parametrize(argname, cases, ids=[p["id"] for p in cases])


def _objects(db, namespace):
    return list(getattr(db, ITERATORS[namespace])())


def test_generic_preset(db, gramps_user, generic_preset):
    ns = generic_preset["namespace"]
    rule_name = generic_preset["sourceRule"]
    objects = _objects(db, ns)
    if rule_name:
        rule_cls = getattr(importlib.import_module(RULE_MODULE[ns]), rule_name)
        args = COUNT_ARGS if _kind(generic_preset) in ("has-notes", "has-media", "has-sources") else []
        assert_goql_matches_rule(db, ns, generic_preset["expr"], rule_cls(args), objects, user=gramps_user)
    else:
        check = PLAIN_CHECKS[_kind(generic_preset)]
        expected = {o.handle for o in objects if check(o)}
        actual = goql_matching_handles(db, ns, generic_preset["expr"], objects)
        assert actual == expected, (
            f"{generic_preset['id']}: {len(expected - actual)} missing, {len(actual - expected)} extra"
        )


def test_tag_preset(db, gramps_user, tag_preset):
    """Fills `{tagName}` the way the UI does (goqlFilterCombiner.ts's
    fillParams()), once per tag that exists in the fixture."""
    ns = tag_preset["namespace"]
    rule_cls = getattr(importlib.import_module(RULE_MODULE[ns]), "HasTag")
    objects = _objects(db, ns)
    tags = list(db.iter_tags())
    assert tags, "example.gramps has no tags to test with"
    for tag in tags:
        expr = tag_preset["expr"].replace("{tagName}", tag.get_name())
        assert_goql_matches_rule(db, ns, expr, rule_cls([tag.get_name()]), objects, user=gramps_user)
