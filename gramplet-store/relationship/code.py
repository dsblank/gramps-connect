#
# The same thing Gramps Desktop puts in its status bar ("Relationship to
# home person"), as a Person gramplet -- plus a chart of the people the
# relationship goes through. get_selected() is the row open in the detail
# pane, get_home_person() is whoever is set as Home person on the Home
# page, and db.get_relationship() asks gramps-web-api's own /relations/
# endpoint -- which runs the real gramps.gen.relationship calculator
# server-side, so this gets desktop's exact wording ("second cousin once
# removed") without reimplementing any of it here.
#
# db.get_relationship_paths() finds the people in between, each labelled
# with their relationship to the Home person, and relationship_chart()
# draws one path the way the app draws its other charts. A path is plain
# data: change a label, or build your own, before charting it. In-laws
# ("wife's father") come from the path search alone -- Gramps' own
# calculator doesn't give them.

from html import escape

person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    home_person = get_home_person()
    if home_person is None:
        # Nobody has set one yet: it's a per-browser preference (the Home
        # page's own Home person card), not something stored in the tree,
        # so this is the normal state on a browser that has never picked
        # one -- worth saying plainly rather than showing an empty chart.
        html("<i>No Home person set -- pick one on the Home page</i>")
    elif home_person.handle == person.handle:
        html("<i>This is your Home person</i>")
    else:
        # Argument order is what makes this read the right way round: the
        # result describes the *second* person in terms of the first, so
        # (home_person, person) gives "son"/"niece"/... meaning the
        # selected person is the Home person's son/niece. Same direction
        # Gramps Desktop's own status bar uses.
        #
        # None comes back when the two genuinely aren't related within the
        # search depth -- pass e.g. depth=25 for a tree deep enough that
        # the default 15 generations isn't reaching a common ancestor.
        # Spouses DO get a string ("wife"), even though they have no common
        # ancestor at all.
        relationship = db.get_relationship(home_person, person)

        # The people in between. An older gramps-connect installs Store
        # updates but has no chart yet: it gets the sentence alone, not an
        # error. max_paths=1: only the nearest path is drawn, and asking
        # for just that one lets the search stop as soon as it's certain.
        paths = []
        if "relationship_chart" in globals():
            paths = db.get_relationship_paths(home_person, person, max_paths=1)

        # The server has no in-law answers ("" above), but the path search
        # does: through a marriage at either end, the people past it
        # labelled relative to the spouse -- so the sentence carries the
        # labels on, "wife's father", "wife's brother's wife".
        if not relationship and paths and paths[0].get("via"):
            married = {m["handle"] for m in paths[0]["via"]}
            prefix = ""
            for p in paths[0]["people"][1:]:
                relationship = prefix + p["relationship_string"]
                if p["handle"] in married:
                    prefix = relationship + "'s "

        if relationship:
            html(f"{escape(name_of(person))} is {escape(name_of(home_person))}'s <b>{escape(relationship)}</b>.")
            if paths:
                relationship_chart(paths[0])
        else:
            html(f"No relationship found between {escape(name_of(person))} and {escape(name_of(home_person))}.")
