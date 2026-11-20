#!/usr/bin/env python3
"""Generate app/src/data/goqlVocabulary.json from the installed
gramps-object-query-language: every name a where_expr can use, per
record type, for the search box's Tab completion
(app/src/store/goqlCompletion.ts).

Also copies GOQL's shared completion test cases to
app/src/store/__tests__/goqlCompletionCases.json, so goqlCompletion.test.ts
checks the TypeScript port against the same cases GOQL's own Python
completer passes. The cases ship only in a source checkout (the wheel
leaves tests out); with a wheel install the existing copy is kept.

Rerun after upgrading GOQL. The JSON records which GOQL version it came
from; a server running an older GOQL may reject a name offered here,
which just shows as the usual error on Enter.

Usage:
    python3 scripts/export-goql-vocabulary.py
"""
import json
import shutil
import sys
from importlib.metadata import version
from pathlib import Path

import gramps_object_query_language
from gramps_object_query_language.vocabulary import vocabularies

ROOT = Path(__file__).resolve().parent.parent
VOCABULARY = ROOT / "app/src/data/goqlVocabulary.json"
CASES = ROOT / "app/src/store/__tests__/goqlCompletionCases.json"


def main() -> int:
    data = {
        "goql_version": version("gramps-object-query-language"),
        "vocabularies": vocabularies(),
    }
    VOCABULARY.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    print(f"wrote {VOCABULARY.relative_to(ROOT)} (GOQL {data['goql_version']})")

    cases = Path(gramps_object_query_language.__file__).parent / "tests/completion_cases.json"
    if cases.exists():
        shutil.copyfile(cases, CASES)
        print(f"copied {CASES.relative_to(ROOT)}")
    else:
        print(f"no {cases.name} in this GOQL install; kept {CASES.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
