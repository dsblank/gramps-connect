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

Two things gen/const.py needs and this minimal wheel can't ship for real:
  1. gen/const.py unconditionally does `from gi.repository import GLib`
     (XDG directory helpers, never reached by gen.lib's own logic) and
     gen/lib/json_utils.py unconditionally does `import orjson` (only its
     *_string()/dict_to_string()/string_to_dict() helpers actually call
     it; data_to_object()/object_to_dict(), the two functions this wheel
     exists for, are pure stdlib). Real stand-ins for both -- actual
     installable wheels, not sys.modules injection -- are
     scripts/build-stub-wheels.py's job, registered as this wheel's own
     `depends` by app/scripts/copy-wasm.mjs, so Pyodide's own
     loadPackage()/loadPackagesFromImports() pulls them in automatically
     the same way it does for any other package's dependencies.
  2. gen/utils/resourcepath.py's real `ResourcePath` is a genuine
     singleton wanting real installed-package files (authors.xml,
     locale/, images/) this minimal wheel deliberately doesn't ship --
     gen/const.py's `ResourcePath()` call at import time calls
     `sys.exit(1)` if it can't find them. Unlike gi/orjson this is a
     module *within* gramps itself, not a third-party dependency, so the
     fix is simpler: RESOURCEPATH_STUB_PY below replaces the real file's
     content in the wheel outright (stage_source()), rather than being
     excluded and patched in at runtime -- the wheel is self-contained
     with no loader-side setup needed at all, for this or the gi/orjson
     case, confirmed by verify_wheel() below installing nothing but this
     wheel + build-stub-wheels.py's own two into a bare, isolated
     environment and importing gramps.gen.lib directly.

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
    # gen/utils/resourcepath.py deliberately isn't copied from the real
    # checkout -- RESOURCEPATH_STUB_PY below is written in its place.
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

# Replaces the real gen/utils/resourcepath.py in the wheel -- see this
# file's docstring point 2. gen.const only reads these four attributes
# (data_dir/image_dir/doc_dir/locale_dir) to build further path constants;
# none of it matters for gen.lib's own object model, so placeholder
# strings (no backing directory needed) are enough.
RESOURCEPATH_STUB_PY = '''\
"""Stand-in for the real gen/utils/resourcepath.py, baked into this wheel
by build-gramps-wheel.py -- the real ResourcePath wants real
installed-package files (authors.xml, locale/, images/) this minimal
wheel doesn't ship, and calls sys.exit(1) if it can't find them."""


class ResourcePath:
    def __init__(self):
        self.data_dir = "/gramps-wheel-stub/data"
        self.image_dir = "/gramps-wheel-stub/images"
        self.doc_dir = "/gramps-wheel-stub/doc"
        self.locale_dir = "/gramps-wheel-stub/locale"
'''


def stage_source(build_root: Path) -> None:
    pkg_root = build_root / "gramps"
    pkg_root.mkdir(parents=True)
    for rel in INCLUDE_PACKAGES:
        shutil.copytree(GRAMPS_PKG_DIR / rel, pkg_root / rel, ignore=shutil.ignore_patterns(*EXCLUDE_DIRS))
    for rel in INCLUDE_FILES:
        dest = pkg_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(GRAMPS_PKG_DIR / rel, dest)
    resourcepath_dest = pkg_root / "gen/utils/resourcepath.py"
    resourcepath_dest.parent.mkdir(parents=True, exist_ok=True)
    resourcepath_dest.write_text(RESOURCEPATH_STUB_PY, encoding="utf-8")
    (build_root / "pyproject.toml").write_text(PYPROJECT_TOML, encoding="utf-8")


def verify_wheel(wheel_path: Path, stub_wheels_dir: Path) -> None:
    """Installs the built wheel -- plus build-stub-wheels.py's gi/orjson
    stand-ins, the only other things gramps.gen.lib needs that aren't
    stdlib -- into an isolated, empty directory (no access to
    GRAMPS_PKG_DIR or anything else on this machine's normal sys.path)
    and round-trips a Person through object_to_dict/data_to_object -- the
    actual thing this wheel exists to let a Gramplet do. A real Pyodide
    run is the only full proof, but this at least proves the wheel is
    genuinely self-contained under plain CPython first, with zero
    loader-side setup beyond installing these three wheels."""
    stub_wheels = sorted(stub_wheels_dir.glob("*.whl"))
    if not stub_wheels:
        print(
            f"verify: skipped -- no wheels in {stub_wheels_dir} "
            "(run scripts/build-stub-wheels.py first)"
        )
        return
    with tempfile.TemporaryDirectory() as install_dir:
        for whl in [wheel_path, *stub_wheels]:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", str(whl), "--no-deps", "--target", install_dir],
                check=True,
            )
        old_path = sys.path[:]
        old_modules = dict(sys.modules)
        sys.path = [install_dir] + [p for p in sys.path if "gramps" not in p.lower()]
        for name in list(sys.modules):
            if name == "gramps" or name.startswith("gramps."):
                del sys.modules[name]
        try:
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
    parser.add_argument(
        "--stub-wheels-dir", type=Path, default=Path(__file__).resolve().parent.parent / "dist" / "stub-wheels"
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
        verify_wheel(wheel_path, args.stub_wheels_dir)


if __name__ == "__main__":
    main()
