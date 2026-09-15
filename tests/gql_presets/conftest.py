"""Shared fixtures for the GOQL built-in preset behavioral-equivalence
suite (see this directory's own README.md for what these tests actually
prove, and gramps-connect's project memory for how this was designed).
"""

import json
import os
import subprocess
import sys

import pytest
from gramps.gen.const import DATA_DIR
from gramps.gen.db.utils import import_as_dict
from gramps.gen.user import User

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(TESTS_DIR))
APP_DIR = os.path.join(REPO_ROOT, "app")
PRESETS_SRC = os.path.join(APP_DIR, "src", "data", "gqlFilterPresets.ts")
PRESETS_JSON = os.path.join(TESTS_DIR, "gql_presets.generated.json")

EXAMPLE_GRAMPS = os.path.join(DATA_DIR, "tests", "example.gramps")


@pytest.fixture(scope="session")
def presets():
    """The exact contents of `gqlFilterPresets.ts`'s own `gqlFilterPresets`
    array, as plain dicts -- regenerated via `export-gql-presets.mjs`
    whenever the JSON export is missing or older than the TS source, so
    `pytest tests/` alone (no separate `npm run` step) is still the only
    command anyone needs. The TS file stays the single source of truth;
    nothing here hand-duplicates a preset's `expr`.
    """
    if not os.path.exists(PRESETS_JSON) or os.path.getmtime(PRESETS_SRC) > os.path.getmtime(PRESETS_JSON):
        subprocess.run(
            ["npm", "run", "export:gql-presets"],
            cwd=APP_DIR,
            check=True,
            stdout=sys.stdout,
            stderr=sys.stderr,
        )
    with open(PRESETS_JSON, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def preset_by_id(presets):
    """`presets`, indexed by `id` -- what every test actually asks for
    (`preset_by_id["has-nickname"]`), so a test reads as "this preset"
    rather than a linear search repeated in every test function.
    """
    return {p["id"]: p for p in presets}


@pytest.fixture(scope="session")
def gramps_user():
    return User()


@pytest.fixture(scope="session")
def db(gramps_user):
    """gramps-core's own bundled example database (2128 people) -- the
    exact fixture gramps-core's *own* `rules/test/*_rules_test.py` suite
    already uses to test these same rule classes. Loaded once per test
    session (`import_as_dict` is not cheap) and never mutated by any test
    here -- every test in this suite is read-only.
    """
    return import_as_dict(EXAMPLE_GRAMPS, gramps_user)
