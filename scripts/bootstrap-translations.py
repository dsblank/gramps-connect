#!/usr/bin/env python3
"""Bootstrap app/public/lang/{locale}.json from sibling Gramps checkouts --
no network access, no Weblate rate limits. Both sibling repos already carry
Weblate's translations merged in locally:

  - ../gramps-web/lang/*.json -- gramps-web's own UI strings, already
    {english: translated} JSON, one file per locale it ships.
  - ../addons-source/*/po/{locale}-local.po -- each addon's own translated
    strings, kept in that addon's own po/ directory (see that repo's
    make.py, whose "update" command is what merges Weblate's translations
    into these files in the first place).

Merges the two into one flat dict per locale. The third relevant corpus, the
Gramps desktop app's ~7644-string vocabulary (../gramps/po/*.po), is
deliberately NOT bootstrapped here: it's translated live at runtime instead,
by POSTing the strings gramps-connect actually needs to gramps-web-api's
existing GET/POST /api/translations/<lang> endpoint (see
app/src/store/translationsApi.ts) -- no static copy to keep in sync with
whatever `gramps` version the server has installed.

Run manually and re-run occasionally to refresh the seed data (e.g. after
pulling newer ../gramps-web or ../addons-source checkouts) -- this is not
part of the npm build; app/public/lang/*.json is tracked in git, like gramps-
web's own lang/*.json, so the app works without anyone needing these sibling
checkouts at all.

Usage:
    python3 scripts/bootstrap-translations.py [--lang xx [xx ...]] [--force]

Requires: polib (`pip install polib`), and ../gramps-web and ../addons-source
checked out as sibling directories of this repo.
"""

import argparse
import json
import sys
from pathlib import Path

import polib

REPO_ROOT = Path(__file__).resolve().parent.parent
GRAMPS_WEB_LANG_DIR = REPO_ROOT.parent / "gramps-web" / "lang"
ADDONS_SOURCE_DIR = REPO_ROOT.parent / "addons-source"
OUT_DIR = REPO_ROOT / "app" / "public" / "lang"


def available_locales() -> list[str]:
    """Driven by what ../gramps-web/lang/ actually ships -- gramps-web has
    already done the work of picking sane locale codes (e.g. "nb", "zh_CN")
    over the raw ones Weblate itself uses (e.g. "nb_NO", "zh_Hans") -- so
    reusing its file names sidesteps re-deriving that mapping."""
    return sorted(p.stem for p in GRAMPS_WEB_LANG_DIR.glob("*.json") if p.stem != "en")


def fetch_web_strings(locale: str) -> dict[str, str]:
    """Already {english: translated} JSON -- use directly."""
    path = GRAMPS_WEB_LANG_DIR / f"{locale}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_addons_strings(locale: str) -> dict[str, str]:
    """One {locale}-local.po per addon -- flatten and merge all of them,
    dropping context-disambiguated (msgctxt), plural (msgid_plural), obsolete
    and untranslated entries. Those are a small minority and are either
    ambiguous to match by source text alone or need per-language plural-rule
    handling this simple bootstrap doesn't do."""
    result: dict[str, str] = {}
    for po_path in sorted(ADDONS_SOURCE_DIR.glob(f"*/po/{locale}-local.po")):
        po = polib.pofile(po_path.read_text(encoding="utf-8"))
        for entry in po:
            if entry.msgctxt or entry.msgid_plural or entry.obsolete:
                continue
            if not entry.translated():
                continue
            result[entry.msgid] = entry.msgstr
    return result


def bootstrap_locale(locale: str, force: bool) -> None:
    out_path = OUT_DIR / f"{locale}.json"
    if out_path.exists() and not force:
        print(f"  skipping {locale} (already exists, use --force to refresh)")
        return
    addons_strings = fetch_addons_strings(locale)
    web_strings = fetch_web_strings(locale)
    if not addons_strings and not web_strings:
        print(f"  {locale}: nothing found, skipping")
        return
    merged = {**addons_strings, **web_strings}  # web wins on collision
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"  {locale}: {len(merged)} strings -> {out_path.relative_to(REPO_ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lang", nargs="+", metavar="XX", help="Only bootstrap these locale(s)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing lang/*.json files")
    args = parser.parse_args()

    if not GRAMPS_WEB_LANG_DIR.is_dir():
        print(f"Expected ../gramps-web checked out as a sibling: {GRAMPS_WEB_LANG_DIR} not found", file=sys.stderr)
        sys.exit(1)
    if not ADDONS_SOURCE_DIR.is_dir():
        print(f"Expected ../addons-source checked out as a sibling: {ADDONS_SOURCE_DIR} not found", file=sys.stderr)
        sys.exit(1)

    all_locales = available_locales()
    locales = args.lang if args.lang else all_locales
    unknown = set(locales) - set(all_locales)
    if unknown:
        print(f"Unknown locale(s) (not in {GRAMPS_WEB_LANG_DIR}): {', '.join(sorted(unknown))}", file=sys.stderr)
        sys.exit(1)

    print(f"Bootstrapping {len(locales)} locale(s) into {OUT_DIR}/")
    for locale in locales:
        bootstrap_locale(locale, args.force)

    # What the app actually has static data for, regardless of which subset
    # --lang targeted this run -- app/src/components/UserMenu.tsx's language
    # picker fetches this (a plain static file, no auth needed) and
    # intersects it with gramps-web-api's live /api/translations/ list, so
    # it only ever offers a language this app can genuinely show something
    # translated in.
    available = sorted(p.stem for p in OUT_DIR.glob("*.json") if p.stem != "index")
    index_path = OUT_DIR / "index.json"
    index_path.write_text(json.dumps(available, indent=2) + "\n", encoding="utf-8")
    print(f"  wrote {index_path.relative_to(REPO_ROOT)} ({len(available)} locales)")


if __name__ == "__main__":
    main()
