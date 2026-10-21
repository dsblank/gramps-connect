#!/usr/bin/env python3
"""Generate app/src/store/coordinateLetters.ts from a Gramps checkout's
po/*.po catalogs: each language's own N/S/E/W letters for place
coordinates, as gramps/gen/utils/place.py derives them (the
"%(north_latitude)s N" ... msgids, with the placeholder and surrounding
spaces stripped).

Only languages whose letters differ from English are written. Like
gettext, fuzzy and empty translations count as untranslated (English).

Also writes app/src/store/__tests__/placeCoords.fixture.json: Gramps' own
conv_lat_lon run over a matrix of coordinate spellings with its letter
table set to each language in turn, so placeCoords.test.ts checks
gramps-connect's parser against the real thing rather than against
hand-copied numbers. Needs that checkout importable as `gramps`.

Usage:
    python3 scripts/gen-coordinate-letters.py <gramps-checkout>
"""
import json
import sys
from pathlib import Path

import polib

KEYS = [
    ("N", "north_latitude"),
    ("S", "south_latitude"),
    ("E", "east_longitude"),
    ("W", "west_longitude"),
]

APP = Path(__file__).resolve().parent.parent / "app"
OUT = APP / "src/store/coordinateLetters.ts"
FIXTURE = APP / "src/store/__tests__/placeCoords.fixture.json"

# Every spelling below, filled in with a direction letter.
LAT_FORMATS = [
    "42°41'55\"{d}", "{d}42°41'55\"", "42° 41′ 55″ {d}", "{d}42º41′55″",
    "42#41'55''{d}", "42°41.9167'{d}", "42°{d}", "42.6986{d}", "{d}42.6986",
    "{d} 42.6986", "42.6986 {d}",
]
LONG_FORMATS = [f.replace("42", "2").replace("41", "53").replace("55", "44").replace(".9167", ".7333")
                .replace("6986", "8956") for f in LAT_FORMATS]
# Spellings with no direction letter, which no language changes.
PLAIN = ["42.6986", "-42.6986", "+42.6986", ".5", "1e1", "42:41:55", "-42:41:55.5",
         "+42:41", "42:60", "42:41:60", "--42:41", "", "abc", "42°41'55\"", "42,6986"]


def letters(po: polib.POFile) -> dict[str, str]:
    result = {}
    for letter, key in KEYS:
        entry = po.find(f"%({key})s {letter}")
        if entry is None or not entry.msgstr or "fuzzy" in entry.flags:
            result[letter] = letter
            continue
        # Same derivation as place.py: substitute "1", then blank it out.
        text = entry.msgstr % {key: "1"}
        result[letter] = text.replace("1", " ").strip()
    return result


def effective(found: dict[str, str]) -> dict[str, str]:
    """place.py's own conflict rule: a table reusing an English letter for
    another direction is dropped. An empty letter (Tamil's south) becomes
    its English one -- deliberately unlike Gramps, whose
    str.replace("", "S") would put an "S" between every character."""
    if (found["S"] == "N" or found["N"] == "S" or found["W"] == "E"
            or found["E"] == "W"):
        return {"N": "N", "S": "S", "E": "E", "W": "W"}
    return {k: v or k for k, v in found.items()}


def write_fixture(table: dict[str, dict[str, str]]) -> None:
    import gramps.gen.utils.place as place

    # Every language with letters of its own, plus English, two that fall
    # back to it (en_GB, nb), and one that falls back to its base (fr_CA).
    langs = sorted(set(table) | {"en", "en_GB", "nb", "fr_CA"})
    all_letters = sorted({v for t in table.values() for v in t.values() if v}
                         | {"N", "S", "E", "W"})
    cases = []

    def check(lang: str, kind: str, text: str, gramps_text: str | None = None) -> None:
        gramps_text = gramps_text or text
        if kind == "lat":
            value = place.conv_lat_lon(gramps_text, "0", "D.D8")[0]
        else:
            value = place.conv_lat_lon("0", gramps_text, "D.D8")[1]
        cases.append([lang, kind, text, None if value is None else float(value)])

    for lang in langs:
        found = table.get(lang) or table.get(lang.split("_")[0])
        letters_ = effective(found) if found else {"N": "N", "S": "S", "E": "E", "W": "W"}
        place.translate_en_loc.clear()
        place.translate_en_loc.update(letters_)
        for kind, formats, own in (("lat", LAT_FORMATS, "NS"), ("long", LONG_FORMATS, "EW")):
            # Every spelling with this language's letters and English ones,
            # plus the other axis's letters (which must fail).
            dirs = {letters_[d] for d in "NSEW"} | set("NSEW")
            for d in sorted(dirs):
                for f in formats:
                    # "S 42.6986" fails in Gramps ("- 42.6986" isn't a
                    # float) while "N 42.6986" works; gramps-connect takes
                    # both, so expect what Gramps gives without the space.
                    gramps_f = f.replace("{d} ", "{d}")
                    check(lang, kind, f.format(d=d), gramps_f.format(d=d))
            # Every other language's letters, which must fail or (a letter
            # that happens to be one of this language's) parse as it does.
            for d in all_letters:
                if d not in dirs:
                    check(lang, kind, formats[0].format(d=d))
            for text in PLAIN:
                check(lang, kind, text)
    rows = ",\n".join(json.dumps(c, ensure_ascii=False) for c in cases)
    FIXTURE.write_text(f"[\n{rows}\n]\n", encoding="utf-8")
    print(f"wrote {len(cases)} cases to {FIXTURE}")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    po_dir = Path(sys.argv[1]) / "po"
    table = {}
    for path in sorted(po_dir.glob("*.po")):
        found = letters(polib.pofile(str(path)))
        if list(found.values()) != ["N", "S", "E", "W"]:
            table[path.stem] = found
    write_fixture(table)
    lines = [
        "// Generated by scripts/gen-coordinate-letters.py from Gramps' po/*.po",
        "// catalogs -- do not edit by hand. Each language's own direction letters",
        "// for place coordinates (see placeCoords.ts); a language missing here",
        "// uses plain N/S/E/W.",
        "export const COORDINATE_LETTERS: Record<string, { N: string; S: string; E: string; W: string }> = {",
    ]
    for lang, found in table.items():
        body = ", ".join(f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in found.items())
        lines.append(f"  {lang}: {{ {body} }},")
    lines.append("};")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {len(table)} languages to {OUT}")


if __name__ == "__main__":
    main()
