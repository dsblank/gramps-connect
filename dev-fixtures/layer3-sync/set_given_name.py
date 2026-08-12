#!/usr/bin/env python3
"""Change a person's given name on the layer3-sync fixture (localhost:5003),
to watch gramps-connect's live sync (historyPoll.ts) pick it up.

Goes through GrampsWebApiDb's mirror + a real DbTxn/commit_person(), same
path Gramps desktop itself would use -- not a raw REST PUT, since the
transactions endpoint expects Gramps' own _class-tagged JSON shape, which
the plain object-query/get endpoints don't return.

Needs GRAMPS_WEB_API_KEY set (see gramps-api-client's Client.mint_api_key)
and the GrampsWebApiDb addon registered in Gramps's user plugins dir.

Usage: python3 set_given_name.py <given_name> [handle]
"""

import logging
import sys
import tempfile

logging.disable(logging.WARNING)  # silences gramps' own locale/data-dir warnings

from gramps.gen.db import DbTxn
from gramps.gen.db.utils import make_database

DEFAULT_HANDLE = "E04KQC637O9JLP5PNM"  # I0553, John Adkins in example.gramps


def main() -> None:
    if len(sys.argv) not in (2, 3):
        print(f"Usage: {sys.argv[0]} <given_name> [handle]", file=sys.stderr)
        sys.exit(1)
    given_name = sys.argv[1]
    handle = sys.argv[2] if len(sys.argv) == 3 else DEFAULT_HANDLE

    db = make_database("grampswebapidb")
    db.load(tempfile.mkdtemp(), callback=None)
    try:
        person = db.get_person_from_handle(handle)
        name = person.primary_name
        surname = name.get_surname_list()[0].get_surname()
        print(f"Before: {person.gramps_id} {name.first_name} {surname}")

        with DbTxn(f"Set given name to {given_name!r}", db) as trans:
            name.set_first_name(given_name)
            db.commit_person(person, trans)

        print(f"After:  {person.gramps_id} {name.first_name} {surname}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
