#!/usr/bin/env python3
"""Generate app/src/data/grampsRecordShapes.json from the installed Gramps:
the exact JSON shape of each Gramps record type, for code that writes
records through POST /api/transactions/ (app/src/store/board/).

That endpoint stores records exactly as sent and compares `old` with the
stored record field by field, so the client needs Gramps' own internal form
(object_to_dict), not the simplified REST form. This file gives it:

- `fields`: every stored field of each top-level type, the `select` list
  for POST /api/<type>/query/, which then returns that internal form as is.
- `blanks`: object_to_dict() of a new, empty object for each top-level and
  nested type the board creates, the starting point for a new record.
- `types`: the integer codes of the Gramps types the board writes (event
  types, roles, child relationships...), so the TypeScript never hard-codes
  a number.

Also writes app/src/data/grampsSchemas.json, for checking records before
they're sent (app/src/store/board/validate.ts), as the Gramplet worker does
in Python:

- `schemas`: Gramps' own get_schema() of each top-level type (JSON Schema).
- `class_keys`: the fields of every Gramps class with a schema, nested ones
  included, so an object with a field Gramps doesn't know is caught.
- `date`: the Date modifier codes and how many `dateval` values each needs.

Rerun after upgrading Gramps. Both files record the Gramps version they came
from.

Usage:
    python3 scripts/export-gramps-record-shapes.py
"""
import json
from pathlib import Path

import gramps.gen.lib as lib
from gramps.gen.const import VERSION
from gramps.gen.lib.json_utils import object_to_dict

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app/src/data/grampsRecordShapes.json"
SCHEMAS_OUT = ROOT / "app/src/data/grampsSchemas.json"

TOP = ["Person", "Family", "Event", "Place", "Source", "Citation", "Repository", "Media", "Note"]
NESTED = ["Name", "Surname", "EventRef", "ChildRef", "MediaRef", "Attribute", "SrcAttribute",
          "RepoRef", "PlaceName", "PlaceRef", "Date", "StyledText", "Url", "Address", "PersonRef"]
TYPES = {
    "EventType": ["BIRTH", "DEATH", "BAPTISM", "BURIAL", "MARRIAGE", "CENSUS", "RESIDENCE",
                  "GRADUATION", "OCCUPATION", "IMMIGRATION", "UNKNOWN", "CUSTOM"],
    "EventRoleType": ["PRIMARY", "FAMILY", "WITNESS", "CLERGY", "CELEBRANT", "INFORMANT",
                      "AIDE", "BRIDE", "GROOM", "UNKNOWN", "CUSTOM"],
    "ChildRefType": ["BIRTH", "ADOPTED", "STEPCHILD", "UNKNOWN", "CUSTOM"],
    "FamilyRelType": ["MARRIED", "UNMARRIED", "CIVIL_UNION", "UNKNOWN", "CUSTOM"],
    "NoteType": ["GENERAL", "CUSTOM"],
    "AttributeType": ["DESCRIPTION", "CUSTOM"],
    "PlaceType": ["CITY", "TOWN", "COUNTY", "STATE", "COUNTRY", "CHURCH", "CEMETERY", "ADDRESS",
                  "UNKNOWN", "CUSTOM"],
    "RepositoryType": ["LIBRARY", "ARCHIVE", "COLLECTION", "WEBSITE", "CHURCH", "UNKNOWN", "CUSTOM"],
}


def main() -> int:
    missing = [f"{t}.{n}" for t, names in TYPES.items() for n in names if not hasattr(getattr(lib, t), n)]
    if missing:
        print("not in this Gramps, left out:", ", ".join(missing))
    data = {
        "gramps_version": VERSION,
        "fields": {c: [k for k in object_to_dict(getattr(lib, c)()) if k != "_class"] for c in TOP},
        "blanks": {c: object_to_dict(getattr(lib, c)()) for c in TOP + NESTED},
        "types": {t: {n: getattr(getattr(lib, t), n) for n in names if hasattr(getattr(lib, t), n)} for t, names in TYPES.items()},
        "person_gender": {"FEMALE": lib.Person.FEMALE, "MALE": lib.Person.MALE, "UNKNOWN": lib.Person.UNKNOWN},
    }
    OUT.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} (Gramps {VERSION})")

    schemas = {}
    for c in TOP:
        cls = getattr(lib, c)
        schema = cls.get_schema()
        # Gramps 5.2 added Person.OTHER = 3, but some versions' schema still
        # caps gender at 2 (see gramps-web-api's validate_object_dict()).
        other = getattr(cls, "OTHER", None)
        gender = schema.get("properties", {}).get("gender")
        if other is not None and gender and gender.get("maximum", other) < other:
            gender["maximum"] = other
        schemas[c] = schema
    class_keys = {}
    for name in dir(lib):
        cls = getattr(lib, name)
        if isinstance(cls, type) and hasattr(cls, "get_schema"):
            try:
                class_keys[name] = sorted(object_to_dict(cls()))
            except Exception:
                pass  # abstract bases that can't be made empty
    D = lib.Date
    date = {
        "min_dateval": {str(D.MOD_NONE): 4, str(D.MOD_BEFORE): 4, str(D.MOD_AFTER): 4, str(D.MOD_ABOUT): 4,
                        str(D.MOD_FROM): 4, str(D.MOD_TO): 4, str(D.MOD_RANGE): 8, str(D.MOD_SPAN): 8},
        "empty": list(D.EMPTY),
    }
    SCHEMAS_OUT.write_text(json.dumps({"gramps_version": VERSION, "schemas": schemas, "class_keys": class_keys, "date": date},
                                      indent=1, sort_keys=True) + "\n")
    print(f"wrote {SCHEMAS_OUT.relative_to(ROOT)} (Gramps {VERSION})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
