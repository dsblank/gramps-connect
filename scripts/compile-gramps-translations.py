#!/usr/bin/env python3
"""Compile a Gramps checkout's po/*.po catalogs into locale/{lang}/LC_MESSAGES/
gramps.mo, matching the layout gramps.gen.utils.resourcepath.ResourcePath
expects at gramps.gen.utils.grampslocale.GrampsLocale.translation lookup time.

Why this is needed: gramps' setup.py only compiles .mo files as a side effect
of its own overridden `build` command (build_trans(), via msgfmt) --
triggered by a normal `pip install .`/`pip wheel .`, but NOT by
`pip install -e . --no-deps`, which both standalone/gramps-connect-
desktop.spec and deploy/Dockerfile use to install gramps from a source
checkout. Without this, gramps_webapi's /api/translations/<lang>/ endpoint
(what app/src/i18n/i18n.ts's desktopStrings corpus is translated through)
has no catalog to look up and silently falls back to English for every
string -- confirmed empirically: an editable install leaves zero .mo files
anywhere, while a non-editable one (e.g. deploy/Dockerfile.slim's
`pip install /src/gramps --no-deps`, which builds a wheel) produces them
correctly via the same build_trans() step.

Uses polib instead of shelling out to msgfmt so this runs the same on
Windows/macOS CI runners (which don't ship gettext) as it does on Linux.

Usage:
    python3 scripts/compile-gramps-translations.py <gramps-checkout> [--out DIR]

<gramps-checkout> must contain po/LINGUAS and po/{lang}.po (i.e. a gramps
source checkout, not an installed package). Default --out is
<gramps-checkout>/build/mo, matching gramps' own build_trans() layout --
ResourcePath's not-installed branch looks there automatically, so an
editable install of that same checkout picks the compiled catalogs up with
no further wiring. Pass an explicit --out for a bundling step (e.g.
PyInstaller) that stages files elsewhere before packaging.

Requires: polib (`pip install polib`).
"""

import argparse
import sys
from pathlib import Path

import polib


def get_linguas(po_dir: Path) -> list[str]:
    linguas: list[str] = []
    for line in (po_dir / "LINGUAS").read_text(encoding="utf-8").splitlines():
        if "#" in line:
            line = line[: line.find("#")]
        linguas.extend(line.split())
    return linguas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("gramps_checkout", type=Path, help="Path to a gramps source checkout (contains po/)")
    parser.add_argument("--out", type=Path, default=None, help="Output locale dir (default: <gramps-checkout>/build/mo)")
    args = parser.parse_args()

    po_dir = args.gramps_checkout / "po"
    if not po_dir.is_dir():
        print(f"{po_dir} not found -- is {args.gramps_checkout} a gramps source checkout?", file=sys.stderr)
        sys.exit(1)
    out_dir = args.out or (args.gramps_checkout / "build" / "mo")

    for lang in get_linguas(po_dir):
        po_path = po_dir / f"{lang}.po"
        mo_dir = out_dir / lang / "LC_MESSAGES"
        mo_dir.mkdir(parents=True, exist_ok=True)
        polib.pofile(str(po_path)).save_as_mofile(str(mo_dir / "gramps.mo"))
        print(f"  compiled {lang}")

    print(f"Compiled {len(get_linguas(po_dir))} catalogs -> {out_dir}")


if __name__ == "__main__":
    main()
