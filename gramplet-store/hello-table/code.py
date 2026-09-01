# =============================================================================
# 01 - Hello Table
# =============================================================================
# The smallest useful Gramplet: run a query against the tree and show the
# results as a table. Start here if you have never written a Gramplet
# before.
#
# Everything you see here (people(), row(), columns(), the "where" string)
# is provided for you automatically -- a Gramplet's code runs in a sandbox
# with no imports needed to reach the tree. See the (i) "Writing a
# Gramplet" help button in the Gramplet editor for the full list.
# =============================================================================

# people(where=None, order=None, limit=50) fetches People matching a query,
# as full records, in one call. There's a families()/events()/places()/
# repositories()/sources()/citations()/media()/notes()/tags() for every
# other object type too -- same signature, just a different table.
#
# "where" is written in Gramps Object Query Language (GOQL) -- the exact
# same syntax as the search box on the People list. Click the (i) button
# next to that search box for the full field reference for Person; the
# building blocks (==, and, or, like(), in, is None, ...) are the same for
# every object type.
#
# No `await` needed even though this is a real network call under the
# hood -- it's inserted for you automatically. The condition below is
# evaluated entirely on the server (it can reach through relationships,
# e.g. birth.date, even though we're not asking to see that field back --
# see 07_relationship_queries.py for how to pull related fields like this
# one back into the table too).
#
# and_filters(get_filter(), ...) layers this Gramplet's own condition on
# top of whatever filter is currently applied on the People view it's a
# tab of (FilterBar's own search box) -- get_filter()'s own doc comment,
# and the (i) help button, cover this further. The manifest's
# listensToFilter re-runs this table when that filter changes, not just
# when this tab is switched to.
matches = people(
    and_filters(get_filter(), "gender == Person.MALE and birth.date.sortval >= Date('Jan 1, 1900')"),
    limit=25,
)

# row(*values) adds one row to the table. A whole Person/Event/Place/...
# object -- not just a hand-picked field of it -- renders as a clickable
# link: it already shows the person's full name and Gramps ID for you
# (no need to also pass person.primary_name / person.gramps_id yourself
# just to display them), and clicking it opens a popup to view that
# record in List, Map, Graph, or Timeline. So the one-column version below
# is already a genuinely useful table on its own.
columns("Person")
for person in matches:
    row(person)

# Every record returned by people()/families()/etc. is a Gramps "DataDict"
# -- a plain dict of the object's fields, but with dot access on top:
# person.primary_name.first_name is the same value as
# person["primary_name"]["first_name"]. Use whichever reads better. Reach
# for this whenever you want to *compute* something from a field, or show
# a field row()'s own object rendering doesn't surface -- see
# 02_person_lookup.py and onward for that.
if matches:
    example = matches[0]
    given = example.primary_name.first_name
    # surname_list is a list because Gramps supports multiple recorded
    # surnames per person -- [0] is the primary one.
    surname = example.primary_name.surname_list[0].surname
    print(f"First match's given name and surname, read separately: {given} / {surname}")

# row(), html(), and print() can each be called as many times as you like,
# in any order -- everything you add shows up in the order you added it.
# A Gramplet with zero matches still runs fine; it just produces an empty
# table.
