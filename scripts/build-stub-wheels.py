#!/usr/bin/env python3
"""Builds two tiny, real, pip-installable wheels -- "gi" and "orjson" --
that stand in for gramps.gen.lib's two unmet native dependencies in
Pyodide. Real PyGObject (gi) is a C/GObject-introspection binding and real
orjson is a compiled Rust extension; neither is buildable for Pyodide/
WASM, and gen.lib only ever needs a handful of functions from each
(confirmed by reading their actual call sites -- see each stub module's
own docstring below), so a small pure-Python stand-in under the same
import name is a correct replacement for gen.lib's purposes, not just an
expedient one.

Previously these were injected into sys.modules at runtime (pyodideWorker.
ts's INSTALL_GRAMPS_STUBS_PY) -- real installable wheels instead, so
Pyodide's own loadPackage()/loadPackagesFromImports() can fetch and
register them exactly like any other package (see app/scripts/
copy-wasm.mjs), rather than a bespoke JS-side install step run before
every Gramplet.

Usage: python3 scripts/build-stub-wheels.py [--out DIR]
Requires: pip. No gramps checkout needed (unlike build-gramps-wheel.py --
this content never changes with gramps' own version).
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

GI_INIT_PY = '''\
"""Minimal stand-in for PyGObject's gi -- see build-stub-wheels.py. Real gi
needs GObject-introspection typelibs, not available in Pyodide; gen.const
(the only caller) just needs require_version() to be a harmless no-op."""


def require_version(namespace, version):
    pass
'''

GLIB_PY = '''\
"""Minimal stand-in for gi.repository.GLib -- see build-stub-wheels.py.
Provides only the four names gramps.gen.const actually reads (confirmed
by grep) to pick user data/config/cache/pictures directories. Under /tmp
specifically, not just any placeholder string -- gen.const's own migration
logic does a real shutil.copytree() into USER_DATA (built from
get_user_data_dir()'s return value) when ~/.gramps/grampsdb exists on the
machine actually running this, which a non-writable path like "/gramps/
data" fails against with a real PermissionError -- confirmed live, under
plain CPython verification with a real ~/.gramps present. /tmp is a safe
default: writable everywhere this runs, including Pyodide's own MEMFS."""


class GError(Exception):
    pass


class UserDirectory:
    DIRECTORY_PICTURES = "PICTURES"


def get_user_data_dir():
    return "/tmp/gramps-connect/data"


def get_user_config_dir():
    return "/tmp/gramps-connect/config"


def get_user_cache_dir():
    return "/tmp/gramps-connect/cache"


def get_user_special_dir(directory):
    return None
'''

ORJSON_INIT_PY = '''\
"""Minimal stand-in for orjson -- see build-stub-wheels.py. Real orjson is
a compiled Rust extension, not buildable for Pyodide/WASM; gramps.gen.lib.
json_utils only ever calls loads()/dumps() (confirmed by grep), both pure
stdlib-equivalent operations, so a plain json-backed shim is a correct
replacement for gen.lib's purposes -- dumps() returns bytes, matching real
orjson's own signature, not str."""
import json as _json


def loads(data):
    return _json.loads(data)


def dumps(obj, default=None):
    return _json.dumps(obj, default=default).encode()
'''

# name -> {relative path: content}. Each becomes its own wheel, named and
# versioned as if it were the real PyPI package it stands in for -- so a
# Gramplet that happens to `import orjson`/`import gi` for its own
# unrelated reasons would also get this stand-in rather than a real
# native one (there is no real one in Pyodide either way); an acceptable
# trade-off for a PoC, not worth a separate fake-vs-real naming scheme.
PACKAGES = {
    "gi": {
        "gi/__init__.py": GI_INIT_PY,
        "gi/repository/__init__.py": "",
        "gi/repository/GLib.py": GLIB_PY,
    },
    "orjson": {
        "orjson/__init__.py": ORJSON_INIT_PY,
    },
}

VERSION = "0.1.0"


def pyproject_toml(name: str) -> str:
    return f"""\
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "{name}"
version = "{VERSION}"
description = "Pyodide stand-in for {name} -- see scripts/build-stub-wheels.py"
requires-python = ">=3.9"

[tool.setuptools.packages.find]
include = ["{name}*"]
"""


def build_one(name: str, files: dict[str, str], out: Path) -> Path:
    with tempfile.TemporaryDirectory() as build_dir:
        build_root = Path(build_dir)
        for rel, content in files.items():
            dest = build_root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(content, encoding="utf-8")
        (build_root / "pyproject.toml").write_text(pyproject_toml(name), encoding="utf-8")
        subprocess.run(
            [sys.executable, "-m", "pip", "wheel", str(build_root), "--no-deps", "-w", str(out)],
            check=True,
        )
    wheels = sorted(out.glob(f"{name}-{VERSION}-*.whl"))
    if not wheels:
        print(f"No wheel produced for {name!r} -- check pip output above", file=sys.stderr)
        sys.exit(1)
    return wheels[-1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--out", type=Path, default=Path(__file__).resolve().parent.parent / "dist" / "stub-wheels"
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for name, files in PACKAGES.items():
        wheel_path = build_one(name, files, args.out)
        print(f"Built {wheel_path}")


if __name__ == "__main__":
    main()
