"""The app-state rules (app/src/store/contextPresets.ts): Bookmarked and
Home person are a plain handle list, built by handleListExpr() there
(mirrored by handle_list_expr() below). These check that rule text
against gramps-core's IsBookmarked and IsDefaultPerson, using the example
tree's own bookmarks and default person as the handles the app would pass.

Matches saved filter just inlines another filter's compiled rules, so it
has no GOQL of its own to check; app/src/store/__tests__/
contextPresets.test.ts covers it.
"""

import importlib

import pytest

from helpers import compare, compare_plain, objects

BOOKMARKS = {
    "Person": "get_bookmarks", "Family": "get_family_bookmarks", "Event": "get_event_bookmarks",
    "Place": "get_place_bookmarks", "Repository": "get_repo_bookmarks", "Source": "get_source_bookmarks",
    "Citation": "get_citation_bookmarks", "Media": "get_media_bookmarks", "Note": "get_note_bookmarks",
}


def handle_list_expr(handles):
    safe = [h.replace("'", "").replace("\\", "") for h in handles]
    safe = [h for h in safe if h]
    if not safe:
        return "handle == ''"
    if len(safe) == 1:
        return f"handle == '{safe[0]}'"
    return "handle in [" + ", ".join(f"'{h}'" for h in safe) + "]"


@pytest.mark.parametrize("ns", list(BOOKMARKS))
def test_bookmarked(db, gramps_user, ns):
    """gramps-core has IsBookmarked only for People and Families; the
    other types are checked against the bookmark list itself."""
    handles = getattr(db, BOOKMARKS[ns])().get()
    rule_cls = getattr(importlib.import_module(f"gramps.gen.filters.rules.{ns.lower()}"), "IsBookmarked", None)
    if rule_cls:
        compare(db, ns, handle_list_expr(handles), rule_cls([]), gramps_user, expect_some=bool(handles))
    else:
        compare_plain(db, ns, handle_list_expr(handles), lambda o: o.handle in handles, expect_some=bool(handles))


def test_some_bookmarks_exist(db):
    """So test_bookmarked isn't only checking empty lists."""
    assert len(db.get_bookmarks().get()) > 1


def test_home_person(db, gramps_user):
    from gramps.gen.filters.rules.person import IsDefaultPerson

    compare(db, "Person", handle_list_expr([db.get_default_handle()]), IsDefaultPerson([]), gramps_user)
    assert objects(db, "Person")
