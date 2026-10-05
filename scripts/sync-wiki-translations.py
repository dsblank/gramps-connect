#!/usr/bin/env python3
"""Bookkeeping for translated wiki pages -- ../gramps-connect.wiki/{Page}.md
alongside sibling {Page}.{lang}.md translations (see DocumentationDialog.tsx
and wikiDocsApi.ts, which fetch these live from the wiki repo and fall back
to English silently when a translation is missing or stale).

This script does NOT translate anything itself -- there's no LLM API wired
into this repo's scripts, and calling one out from here would be a real
infra/cost decision nobody's made. Producing (or updating) a translation is
still a manual step, same as it was for the first one (Home.de.md): ask an
assistant, or translate by hand, then run `stamp` here to record it.

What this script does do:
  - `report` (default): for every English page, list each translation and
    whether it's missing a marker or stale against the current English
    source -- the to-do list for a translation pass.
  - `stamp PAGE LANG`: after writing/updating {PAGE}.{LANG}.md, recompute
    the English source's content hash and (re)write the leading
    `<!-- translated-from-sha: ... -->` marker, then regenerate that page's
    heading anchors and cross-link header block, and that language's links.
  - `anchors [PAGE ...]`: give every translated heading an explicit
    `<a id="english-slug"></a>`, so links written against the English
    headings (`Overview#speed`) still land on the translated section.
    Also run by `stamp`. Idempotent.
  - `links [LANG ...]`: point each translated page's links to other wiki
    pages at that language's version when one exists ("Overview.es"), so
    GitHub readers stay in their language. Also run by `stamp`. Idempotent.
  - `crosslinks [PAGE ...]`: regenerate the "available in"/"back to
    English" header block for the given pages (all of them if none given),
    without touching any hash marker. Idempotent -- safe to re-run.

Usage:
    python3 scripts/sync-wiki-translations.py [report]
    python3 scripts/sync-wiki-translations.py stamp Home de
    python3 scripts/sync-wiki-translations.py crosslinks [PAGE ...]
    python3 scripts/sync-wiki-translations.py anchors [PAGE ...]
    python3 scripts/sync-wiki-translations.py links [LANG ...]

Requires ../gramps-connect.wiki checked out as a sibling of this repo.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WIKI_DIR = REPO_ROOT.parent / "gramps-connect.wiki"
LOCALES_PATH = REPO_ROOT / "app" / "public" / "lang" / "index.json"

# GitHub-recognized special pages, rendered on every wiki page automatically
# (DocumentationDialog.tsx also fetches "_Sidebar" directly, as in-app nav).
# Still hash-tracked like any other page (report/stamp apply normally), but
# skipped by sync_crosslinks -- injecting an "available in" banner into the
# nav/footer chrome itself, rather than into a piece of content, would be
# more confusing than useful.
SPECIAL_PAGES = {"_Sidebar", "_Footer"}

SHA_LEN = 12  # matches the marker hand-written for Home.de.md
SHA_MARKER_RE = re.compile(r"<!--\s*translated-from-sha:\s*([0-9a-f]+)\s*-->\n?")

CROSSLINK_START = "<!-- wiki-i18n:available-in:start -->"
CROSSLINK_END = "<!-- wiki-i18n:available-in:end -->"
CROSSLINK_RE = re.compile(re.escape(CROSSLINK_START) + r".*?" + re.escape(CROSSLINK_END) + r"\n*", re.DOTALL)
LEADING_COMMENTS_RE = re.compile(r"(?:[ \t]*<!--.*?-->[ \t]*\n)*", re.DOTALL)

# Deliberately incomplete -- only languages an actual translation has been
# done for need a real entry; everything else falls back to its bare code,
# which is still a correct (if plain) link label.
NATIVE_NAMES = {
    "de": "Deutsch",
    "fr": "Français",
    "es": "Español",
}


def available_locales() -> set[str]:
    """Locales the app itself already ships some UI translation for (see
    scripts/bootstrap-translations.py) -- a wiki translation is only ever
    worth having in a language gramps-connect can otherwise speak."""
    return set(json.loads(LOCALES_PATH.read_text(encoding="utf-8")))


def native_name(lang: str) -> str:
    return NATIVE_NAMES.get(lang, lang)


def content_hash(path: Path) -> str:
    """Hashes the page's own prose, not its auto-generated cross-link banner
    -- otherwise regenerating that banner (e.g. because a new language was
    added to a *different* page) would spuriously mark every existing
    translation of *this* page stale."""
    text = strip_crosslink_block(path.read_text(encoding="utf-8"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:SHA_LEN]


def english_pages(locales: set[str]) -> list[str]:
    """Every English wiki page's name (no ".md") -- anything whose stem
    doesn't end in ".{known-locale}", which would make it a translation
    instead."""
    pages = []
    for path in sorted(WIKI_DIR.glob("*.md")):
        stem = path.stem
        parts = stem.split(".")
        if len(parts) > 1 and parts[-1] in locales:
            continue
        pages.append(stem)
    return pages


def translations_for(page: str, locales: set[str]) -> dict[str, Path]:
    result = {}
    for path in WIKI_DIR.glob(f"{page}.*.md"):
        lang = path.stem.split(".")[-1]
        if lang in locales:
            result[lang] = path
    return result


def marker_sha(path: Path) -> str | None:
    match = SHA_MARKER_RE.search(path.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def report() -> None:
    locales = available_locales()
    pages = english_pages(locales)
    any_translations = False
    for page in pages:
        translations = translations_for(page, locales)
        if not translations:
            continue
        any_translations = True
        en_hash = content_hash(WIKI_DIR / f"{page}.md")
        for lang, path in sorted(translations.items()):
            stamped = marker_sha(path)
            if stamped is None:
                status = "MISSING MARKER (never stamped)"
            elif stamped != en_hash:
                status = f"STALE (marker {stamped}, source {en_hash})"
            else:
                status = "up to date"
            print(f"{page} [{lang}]: {status}")
    if not any_translations:
        print(f"No translated pages found yet ({len(pages)} English page(s) checked).")


def strip_crosslink_block(text: str) -> str:
    return CROSSLINK_RE.sub("", text)


def insert_crosslink_block(text: str, block: str) -> str:
    text = strip_crosslink_block(text)
    match = LEADING_COMMENTS_RE.match(text)
    prefix = match.group(0) if match else ""
    rest = text[len(prefix):].lstrip("\n")
    return f"{prefix}{block}{rest}"


def sync_crosslinks(page: str, locales: set[str]) -> None:
    if page in SPECIAL_PAGES:
        print(f"{page}: skipping cross-link banner (nav/footer chrome, not content)")
        return

    translations = translations_for(page, locales)
    en_path = WIKI_DIR / f"{page}.md"

    en_text = strip_crosslink_block(en_path.read_text(encoding="utf-8"))
    if translations:
        links = " · ".join(f"[{native_name(lang)}]({page}.{lang})" for lang in sorted(translations))
        block = f"{CROSSLINK_START}\n🌐 *Also available in: {links}*\n{CROSSLINK_END}\n\n"
        en_text = insert_crosslink_block(en_text, block)
    en_path.write_text(en_text, encoding="utf-8")

    for lang, path in translations.items():
        siblings = sorted(l for l in translations if l != lang)
        parts = [f"[English]({page})"] + [f"[{native_name(l)}]({page}.{l})" for l in siblings]
        block = f"{CROSSLINK_START}\n🌐 *{' · '.join(parts)}*\n{CROSSLINK_END}\n\n"
        text = insert_crosslink_block(path.read_text(encoding="utf-8"), block)
        path.write_text(text, encoding="utf-8")

    print(f"{page}: cross-links synced ({len(translations)} translation(s))")


HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$")
FENCE_RE = re.compile(r"^[ \t]*(```|~~~)")
ANCHOR_SUFFIX_RE = re.compile(r'[ \t]*<a id="[^"]*"></a>[ \t]*$')


def github_slug(text: str) -> str:
    """GitHub's heading-anchor slug (github-slugger): strip inline markup,
    lowercase, drop punctuation, spaces -> hyphens. The in-app viewer
    (app/src/store/wikiMarkdown.ts) computes the same thing."""
    text = re.sub(r"<[^>]*>", "", text)
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = text.replace("`", "").replace("*", "")
    text = text.strip().lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def heading_lines(lines: list[str]) -> list[tuple[int, int, str]]:
    """(line index, level, heading text) for every ATX heading outside a
    fenced code block -- a `# comment` inside ```sh is not a heading."""
    result = []
    in_fence = False
    for i, line in enumerate(lines):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = HEADING_RE.match(line)
        if match:
            result.append((i, len(match.group(1)), ANCHOR_SUFFIX_RE.sub("", match.group(2))))
    return result


def unique_slugs(texts: list[str]) -> list[str]:
    """Slugs with GitHub's "-1", "-2", ... suffixes for repeated headings."""
    seen: dict[str, int] = {}
    slugs = []
    for text in texts:
        slug = github_slug(text)
        count = seen.get(slug, 0)
        seen[slug] = count + 1
        slugs.append(slug if count == 0 else f"{slug}-{count}")
    return slugs


def sync_anchors(page: str, lang: str) -> None:
    """Give each translated heading an explicit `<a id="english-slug"></a>`,
    so a link written against the English page (`Overview#speed`, or a
    same-page `#tls`) still lands on the right section of the translation --
    translated heading text slugs differently. Headings are paired by
    position, which only works while the translation has the same heading
    outline as its source; a mismatch (usually a stale translation) is
    reported and the page is left alone. Level-1 page titles are skipped."""
    en_lines = (WIKI_DIR / f"{page}.md").read_text(encoding="utf-8").split("\n")
    path = WIKI_DIR / f"{page}.{lang}.md"
    lines = path.read_text(encoding="utf-8").split("\n")

    en_headings = heading_lines(en_lines)
    tr_headings = heading_lines(lines)
    if [lvl for _, lvl, _ in en_headings] != [lvl for _, lvl, _ in tr_headings]:
        print(f"{path.name}: heading outline differs from {page}.md -- anchors not synced")
        return

    en_slugs = unique_slugs([text for _, _, text in en_headings])
    tr_slugs = unique_slugs([text for _, _, text in tr_headings])
    added = 0
    for (i, level, text), en_slug, tr_slug in zip(tr_headings, en_slugs, tr_slugs):
        line = f"{'#' * level} {text}"
        if level > 1 and en_slug != tr_slug:
            line += f' <a id="{en_slug}"></a>'
            added += 1
        lines[i] = line
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"{path.name}: {added} heading anchor(s) synced")


WIKI_LINK_RE = re.compile(r"\]\(([A-Za-z0-9_-]+(?:\.[A-Za-z_]+)?)(#[^)\s]*)?\)")


def sync_links(lang: str, locales: set[str]) -> None:
    """Point every translated page's links to other wiki pages at that same
    language's version (`](Overview#speed)` -> `](Overview.es#speed)`)
    whenever one exists, and back at English when it doesn't -- so a reader
    on GitHub stays in their language. The in-app viewer strips the suffix
    again and resolves the language itself. Only links in the page body:
    the cross-link banner deliberately points at other languages, fenced
    code isn't a link, and _Sidebar/_Footer are skipped since GitHub only
    ever renders the English _Sidebar.md (the translated ones are in-app
    nav only). Idempotent."""
    pages = english_pages(locales)
    has_translation = {page for page in pages if (WIKI_DIR / f"{page}.{lang}.md").is_file()}

    def localize(match: re.Match) -> str:
        target, anchor = match.group(1), match.group(2) or ""
        base, _, suffix = target.partition(".")
        if suffix and suffix not in locales:
            return match.group(0)
        if base not in pages:
            return match.group(0)
        localized = f"{base}.{lang}" if base in has_translation else base
        return f"]({localized}{anchor})"

    for page in sorted(has_translation - SPECIAL_PAGES):
        path = WIKI_DIR / f"{page}.{lang}.md"
        text = path.read_text(encoding="utf-8")
        banner = CROSSLINK_RE.search(text)
        head, body = (text[: banner.end()], text[banner.end():]) if banner else ("", text)
        # Odd-numbered pieces of a split on fence lines are inside code blocks.
        pieces = re.split(r"(^[ \t]*(?:```|~~~).*$)", body, flags=re.M)
        in_fence = False
        for k, piece in enumerate(pieces):
            if k % 2 == 1:
                in_fence = not in_fence
            elif not in_fence:
                pieces[k] = WIKI_LINK_RE.sub(localize, piece)
        new_text = head + "".join(pieces)
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
            print(f"{path.name}: links localized")


def stamp(page: str, lang: str, locales: set[str]) -> None:
    en_path = WIKI_DIR / f"{page}.md"
    translated_path = WIKI_DIR / f"{page}.{lang}.md"
    if not en_path.is_file():
        sys.exit(f"No such English page: {en_path}")
    if not translated_path.is_file():
        sys.exit(f"No such translation: {translated_path}")

    new_hash = content_hash(en_path)
    text = translated_path.read_text(encoding="utf-8")
    marker_line = f"<!-- translated-from-sha: {new_hash} -->\n"
    text = SHA_MARKER_RE.sub("", text, count=1)
    translated_path.write_text(marker_line + text, encoding="utf-8")
    print(f"{translated_path.relative_to(WIKI_DIR)}: stamped with {new_hash}")

    sync_anchors(page, lang)
    sync_crosslinks(page, locales)
    # A new translation changes where every other page in this language
    # should link to, not just this one.
    sync_links(lang, locales)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("report", help="List every translation and whether it's missing a marker or stale")
    stamp_parser = sub.add_parser("stamp", help="Record a translation's current source hash and sync cross-links")
    stamp_parser.add_argument("page")
    stamp_parser.add_argument("lang")
    crosslinks_parser = sub.add_parser("crosslinks", help="Regenerate cross-link header blocks (default: all pages)")
    crosslinks_parser.add_argument("pages", nargs="*")
    anchors_parser = sub.add_parser("anchors", help="Regenerate English heading anchors in translations (default: all pages)")
    anchors_parser.add_argument("pages", nargs="*")
    links_parser = sub.add_parser("links", help="Point translated pages' links at same-language pages (default: all languages)")
    links_parser.add_argument("langs", nargs="*")
    args = parser.parse_args()

    if not WIKI_DIR.is_dir():
        sys.exit(f"Expected ../gramps-connect.wiki checked out as a sibling: {WIKI_DIR} not found")
    if not LOCALES_PATH.is_file():
        sys.exit(f"Expected {LOCALES_PATH} -- run scripts/bootstrap-translations.py first")

    locales = available_locales()
    command = args.command or "report"
    if command == "report":
        report()
    elif command == "stamp":
        stamp(args.page, args.lang, locales)
    elif command == "crosslinks":
        pages = args.pages or english_pages(locales)
        for page in pages:
            sync_crosslinks(page, locales)
    elif command == "anchors":
        for page in args.pages or english_pages(locales):
            for lang in sorted(translations_for(page, locales)):
                sync_anchors(page, lang)
    elif command == "links":
        for lang in args.langs or sorted({l for p in english_pages(locales) for l in translations_for(p, locales)}):
            sync_links(lang, locales)


if __name__ == "__main__":
    main()
