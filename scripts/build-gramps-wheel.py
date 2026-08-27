#!/usr/bin/env python3
"""Build a minimal, pure-Python "gramps" wheel for Pyodide -- just enough
of gramps.gen.lib (plus its handful of real dependencies) to construct
genuine Gramps objects from gramps-web-api's own JSON dict shape, via
gramps.gen.lib.json_utils's data_to_object()/object_to_dict(). Built to
replace the JSON-string-only boundary app/src/pyodidePoc/'s Gramplets use
today with real gen.lib objects running inside the Pyodide worker (see
project memory: the pyodide-addon-poc entry).

Not the whole gramps package: no gen.plug (report/import/export
machinery), gen.simple, gen.datehandler (pulls in ~30 per-locale parser
modules), or anything gui/GTK-related -- none of that is reachable from
gen.lib + json_utils. INCLUDE_FILES below was derived empirically, not
guessed: stub gi.repository.GLib (see standalone/runtime_hooks/
rthook_gi_stub.py's fake -- same trick, this just needs its own copy since
that one lives under standalone/), then diff sys.modules before/after
    import gramps.gen.lib
    from gramps.gen.lib.json_utils import data_to_object, object_to_dict
and take every "gramps.*" name that appeared.

Three things gen/const.py needs are stubbed rather than shipped for real,
matching "stub the missing native dependency, don't touch vendor source"
(same call standalone/runtime_hooks/rthook_gi_stub.py already made for
gi):
  1. gen/const.py unconditionally does `from gi.repository import GLib`
     (XDG directory helpers, never reached by gen.lib's own logic).
  2. gen/lib/json_utils.py unconditionally does `import orjson` -- only
     its *_string()/dict_to_string()/string_to_dict() helpers actually
     call it; data_to_object()/object_to_dict(), the two functions this
     wheel exists for, are pure stdlib, so a plain-json shim is a correct
     replacement, not just an expedient one.
  3. gen/utils/resourcepath.py's `ResourcePath` is a genuine singleton
     wanting real installed-package files (authors.xml, locale/,
     images/) that this minimal wheel deliberately doesn't ship --
     gen/const.py's `ResourcePath()` call at import time calls
     `sys.exit(1)` if it can't find them. So this file is left out of
     INCLUDE_FILES entirely and its class is stubbed instead of shipped.
Whoever loads this wheel in Pyodide must install all three sys.modules
stand-ins *before* importing gramps -- that loader-side code doesn't
exist yet; this script only builds the wheel. verify_wheel() below does
exactly that stubbing to prove the built wheel is genuinely
self-contained (installed into an isolated dir with no access to the real
gramps checkout on sys.path).

Usage: python3 scripts/build-gramps-wheel.py [--out DIR] [--no-verify]
Requires: gramps importable (pip -e installed, see
feedback_gramps_editable_install memory) and pip.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import types
from pathlib import Path

import gramps
from gramps.version import VERSION

GRAMPS_PKG_DIR = Path(gramps.__file__).resolve().parent  # .../gramps/gramps

# Whole subpackages, copied wholesale -- self-contained, no huge transitive
# deps of their own (same "gen.lib is cheap to include whole" finding the
# PyInstaller standalone build already made).
INCLUDE_PACKAGES = ["gen/lib"]

# Individual files gen.lib + json_utils actually reach -- see this file's
# docstring for how this list was derived.
INCLUDE_FILES = [
    "__init__.py",
    "version.py",
    "gen/__init__.py",
    "gen/const.py",
    "gen/constfunc.py",
    "gen/config.py",
    "gen/errors.py",
    "gen/git_revision.py",
    "gen/utils/__init__.py",
    "gen/utils/configmanager.py",
    "gen/utils/grampslocale.py",
    "gen/utils/grampstranslation.py",
    "gen/utils/win32locale.py",
    # gen/utils/resourcepath.py is deliberately NOT included -- see this
    # file's docstring point 3. install_stubs() below replaces it.
]

# gen/lib/test/ isn't reached at import time and adds nothing a Gramplet
# would use; __pycache__ is just build noise from this dev machine.
EXCLUDE_DIRS = {"test", "__pycache__"}

DIST_NAME = "gramps-gen-lib"

PYPROJECT_TOML = f"""\
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "{DIST_NAME}"
version = "{VERSION}"
description = "Trimmed, pure-Python subset of gramps.gen.lib for Pyodide -- see build-gramps-wheel.py"
requires-python = ">=3.9"

[tool.setuptools.packages.find]
include = ["gramps*"]
"""


def stage_source(build_root: Path) -> None:
    pkg_root = build_root / "gramps"
    pkg_root.mkdir(parents=True)
    for rel in INCLUDE_PACKAGES:
        shutil.copytree(GRAMPS_PKG_DIR / rel, pkg_root / rel, ignore=shutil.ignore_patterns(*EXCLUDE_DIRS))
    for rel in INCLUDE_FILES:
        dest = pkg_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(GRAMPS_PKG_DIR / rel, dest)
    (build_root / "pyproject.toml").write_text(PYPROJECT_TOML, encoding="utf-8")


def install_stubs() -> None:
    """The gi/orjson stand-ins described in this file's docstring -- used
    here only to prove the wheel is self-contained; a Pyodide-side loader
    will need its own copy of this before `import gramps...`."""
    glib = types.ModuleType("gi.repository.GLib")
    glib.GError = type("GError", (Exception,), {})
    glib.UserDirectory = type("UserDirectory", (), {"DIRECTORY_PICTURES": "PICTURES"})
    glib.get_user_data_dir = lambda: "/tmp/gramps-wheel-check/data"
    glib.get_user_config_dir = lambda: "/tmp/gramps-wheel-check/config"
    glib.get_user_cache_dir = lambda: "/tmp/gramps-wheel-check/cache"
    glib.get_user_special_dir = lambda directory: None
    repository = types.ModuleType("gi.repository")
    repository.GLib = glib
    gi = types.ModuleType("gi")
    gi.require_version = lambda namespace, version: None
    gi.repository = repository
    sys.modules["gi"] = gi
    sys.modules["gi.repository"] = repository
    sys.modules["gi.repository.GLib"] = glib

    import json as _json

    orjson = types.ModuleType("orjson")
    orjson.loads = _json.loads
    orjson.dumps = lambda obj, default=None: _json.dumps(obj, default=default).encode()
    sys.modules["orjson"] = orjson

    resourcepath = types.ModuleType("gramps.gen.utils.resourcepath")

    class ResourcePath:
        """Stand-in for the real singleton (gen/utils/resourcepath.py) --
        that one wants real installed-package files (authors.xml, locale/,
        images/) this minimal wheel doesn't ship, and calls sys.exit(1) if
        it can't find them. gen.const only reads these four attributes
        (data_dir/image_dir/doc_dir/locale_dir) to build further path
        constants -- none of it matters for gen.lib's own object model, so
        placeholder strings (no backing directory needed) are enough."""

        def __init__(self):
            self.data_dir = "/gramps-wheel-stub/data"
            self.image_dir = "/gramps-wheel-stub/images"
            self.doc_dir = "/gramps-wheel-stub/doc"
            self.locale_dir = "/gramps-wheel-stub/locale"

    resourcepath.ResourcePath = ResourcePath
    sys.modules["gramps.gen.utils.resourcepath"] = resourcepath


def verify_wheel(wheel_path: Path) -> None:
    """Installs the built wheel into an isolated, empty directory (no
    access to GRAMPS_PKG_DIR or anything else on this machine's normal
    sys.path) and round-trips a Person through object_to_dict/
    data_to_object -- the actual thing this wheel exists to let a Gramplet
    do. A real Pyodide run is the only full proof, but this at least
    proves the wheel is genuinely self-contained under plain CPython
    before anyone tries it in a browser."""
    with tempfile.TemporaryDirectory() as install_dir:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", str(wheel_path), "--no-deps", "--target", install_dir],
            check=True,
        )
        old_path = sys.path[:]
        old_modules = dict(sys.modules)
        sys.path = [install_dir] + [p for p in sys.path if "gramps" not in p.lower()]
        for name in list(sys.modules):
            if name == "gramps" or name.startswith("gramps."):
                del sys.modules[name]
        try:
            install_stubs()
            import gramps.gen.lib as lib
            from gramps.gen.lib.json_utils import data_to_object, object_to_dict

            person = lib.Person()
            person.set_gramps_id("I0001")
            data = object_to_dict(person)
            restored = data_to_object(data)
            assert restored.gramps_id == "I0001", restored.gramps_id
            print(f"verify: OK -- round-tripped a Person via the installed wheel ({lib.__file__})")
        finally:
            sys.path[:] = old_path
            sys.modules.clear()
            sys.modules.update(old_modules)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--out", type=Path, default=Path(__file__).resolve().parent.parent / "dist" / "gramps-wheel"
    )
    parser.add_argument("--no-verify", action="store_true", help="Skip the isolated-install round-trip check")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as build_dir:
        build_root = Path(build_dir)
        stage_source(build_root)
        subprocess.run(
            [sys.executable, "-m", "pip", "wheel", str(build_root), "--no-deps", "-w", str(args.out)],
            check=True,
        )

    wheels = sorted(args.out.glob(f"{DIST_NAME.replace('-', '_')}-*.whl"))
    if not wheels:
        print("No wheel produced -- check pip output above", file=sys.stderr)
        sys.exit(1)
    wheel_path = wheels[-1]
    print(f"Built {wheel_path}")

    if not args.no_verify:
        verify_wheel(wheel_path)


if __name__ == "__main__":
    main()
