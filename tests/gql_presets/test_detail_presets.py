"""Behavioral-equivalence tests for the shared rules with values
(`detailPresets()` / `DETAIL_RULE_TARGETS` in gqlFilterPresets.ts): Gramps
ID, changed since, number of references, note text/regex/type and citation
confidence, on every type that has them.

Each is compared against the type's own gramps-core rule in
rules/<type>/; where a type has no such rule (e.g. no
HasNoteMatchingSubstringOf for Sources), against the shared base class the
others are built on, which is what the type's rule would be. Values are
filled in by helpers.fill(), which mirrors goqlFilterCombiner.ts's
fillParam().
"""

import importlib
import time

import pytest
from gramps.gen.filters.rules._changedsincebase import ChangedSinceBase
from gramps.gen.filters.rules._hasnoteregexbase import HasNoteRegexBase
from gramps.gen.filters.rules._hasnotesubstrbase import HasNoteSubstrBase
from gramps.gen.filters.rules._hasnotetypebase import HasNoteTypeBase
from gramps.gen.filters.rules._hasreferencecountbase import HasReferenceCountBase
from gramps.gen.filters.rules._matchessourceconfidencebase import MatchesSourceConfidenceBase

from helpers import compare, fill, objects

ALL = ["Family", "Event", "Place", "Repository", "Source", "Citation", "Media", "Note"]
WITH_NOTES = ["Family", "Event", "Place", "Repository", "Source", "Citation", "Media"]
WITH_CITATIONS = ["Family", "Event", "Place", "Media"]


def rule(ns, name, base, *args, **kwargs):
    module = importlib.import_module(f"gramps.gen.filters.rules.{ns.lower()}")
    return getattr(module, name, base)(*args, **kwargs)


ID_PATTERNS = {
    "Family": r"^f00[1-3]\d$",
    "Event": r"^e\d{3}1$", "Place": r"P00[0-2]\d", "Repository": r"r000[01]", "Source": r"^s000[0-2]$",
    "Citation": r"C00\d0", "Media": r"^o\d{3}[1-3]", "Note": r"n\d{3}1",
}

# Note text each type's own notes contain, where any of its objects has notes.
NOTE_TEXT = {"Family": "GRAMPS AID", "Event": "FIND OUT", "Source": "important", "Citation": "blue moon", "Repository": "librarian"}
NOTE_REGEX = {"Family": r"look\s+for", "Event": r"how\s+did", "Source": r"my\s+name", "Citation": r"third\s+blue", "Repository": r"ask\s+lib"}
NOTE_TYPE = {"Family": "Family Note", "Event": "Event Note", "Source": "Transcript", "Citation": "Source text", "Repository": "Repository Note"}


@pytest.mark.parametrize("ns", ALL)
def test_id_is(db, gramps_user, preset_by_id, ns):
    objs = objects(db, ns)
    gid = objs[len(objs) // 2].gramps_id
    compare(db, ns, fill(preset_by_id[f"{ns.lower()}-id-is"], id=gid), rule(ns, "HasIdOf", None, [gid]), gramps_user)


@pytest.mark.parametrize("ns", ALL)
def test_id_matches(db, gramps_user, preset_by_id, ns):
    """Lower-case patterns check the case-insensitivity; `\\d` checks that
    a backslash survives fill()'s escaping."""
    pattern = ID_PATTERNS[ns]
    p = preset_by_id[f"{ns.lower()}-id-matches"]
    compare(db, ns, fill(p, pattern=pattern), rule(ns, "RegExpIdOf", None, [pattern], use_regex=True), gramps_user)


@pytest.mark.parametrize("ns", ALL)
def test_changed_since(db, gramps_user, preset_by_id, ns):
    changes = sorted({o.change for o in objects(db, ns)})
    since = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(changes[len(changes) // 2]))
    seconds = int(time.mktime(time.strptime(since, "%Y-%m-%d %H:%M:%S")))
    p = preset_by_id[f"{ns.lower()}-changed-since"]
    compare(db, ns, fill(p, since=seconds), rule(ns, "ChangedSince", ChangedSinceBase, [since, ""]), gramps_user)


@pytest.mark.parametrize("ns", ALL)
@pytest.mark.parametrize("op,word", [(">", "greater than"), ("<", "less than"), ("==", "equal to")])
@pytest.mark.parametrize("count", [1, 3])
def test_reference_count(db, gramps_user, preset_by_id, ns, op, word, count):
    p = preset_by_id[f"{ns.lower()}-reference-count"]
    compare(
        db, ns, fill(p, comparison=op, count=count),
        rule(ns, "HasReferenceCountOf", HasReferenceCountBase, [word, str(count)]), gramps_user, expect_some=False,
    )


@pytest.mark.parametrize("ns", WITH_NOTES)
def test_notes_contain(db, gramps_user, preset_by_id, ns):
    text = NOTE_TEXT.get(ns, "FIND OUT")
    p = preset_by_id[f"{ns.lower()}-notes-contain"]
    compare(
        db, ns, fill(p, text=text), rule(ns, "HasNoteMatchingSubstringOf", HasNoteSubstrBase, [text]), gramps_user,
        expect_some=ns in NOTE_TEXT,
    )


@pytest.mark.parametrize("ns", WITH_NOTES)
def test_notes_match(db, gramps_user, preset_by_id, ns):
    pattern = NOTE_REGEX.get(ns, r"how\s+did")
    p = preset_by_id[f"{ns.lower()}-notes-match"]
    compare(
        db, ns, fill(p, pattern=pattern), rule(ns, "HasNoteRegexp", HasNoteRegexBase, [pattern], use_regex=True),
        gramps_user, expect_some=ns in NOTE_REGEX,
    )


@pytest.mark.parametrize("ns", WITH_NOTES)
@pytest.mark.parametrize("which", ["matching", "General", "My Custom Type"])
def test_note_type(db, gramps_user, preset_by_id, ns, which):
    note_type = NOTE_TYPE.get(ns, "Event Note") if which == "matching" else which
    p = preset_by_id[f"{ns.lower()}-note-type"]
    compare(
        db, ns, fill(p, noteType=note_type), rule(ns, "HasNoteType", HasNoteTypeBase, [note_type]), gramps_user,
        expect_some=(which == "matching" and ns in NOTE_TYPE),
    )


@pytest.mark.parametrize("ns", WITH_CITATIONS)
@pytest.mark.parametrize("level", [0, 2, 4])
def test_citation_confidence(db, gramps_user, preset_by_id, ns, level):
    p = preset_by_id[f"{ns.lower()}-citation-confidence"]
    compare(
        db, ns, fill(p, level=level),
        rule(ns, "MatchesSourceConfidence", MatchesSourceConfidenceBase, [str(level)]), gramps_user,
        expect_some=False,
    )
