#
# The same thing Gramps Desktop puts in its status bar ("Relationship to
# home person"), as a Person gramplet -- plus a chart of the people the
# relationship goes through. get_selected() is the row open in the detail
# pane, get_home_person() is whoever is set as Home person on the Home
# page.
#
# db.get_relationship_paths() asks gramps-web-api for the chains of
# parents, children, siblings and marriages between the two, each person
# labelled with their relationship to the Home person by the real
# gramps.gen.relationship calculator -- desktop's exact wording ("second
# cousin once removed", "father-in-law") without reimplementing any of it
# here. relationship_chart() draws them the way the app draws its other
# charts, with a pager when there's more than one. A path is plain data:
# change a label, or build your own, before charting it.

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
        # Argument order is what makes this read the right way round: each
        # label describes a person in terms of the first one, so
        # (home_person, person) gives "son"/"niece"/... meaning the
        # selected person is the Home person's son/niece. Same direction
        # Gramps Desktop's own status bar uses. The shortest comes first;
        # up to five, for the chart's pager.
        paths = db.get_relationship_paths(home_person, person, max_paths=5)

        if not paths:
            # None within 15 links, the most the search goes.
            html(f"No relationship found between {escape(name_of(person))} and {escape(name_of(home_person))}.")
        else:
            relationship = paths[0]["steps"][-1]["label"]
            html(f"{escape(name_of(person))} is {escape(name_of(home_person))}'s <b>{escape(relationship)}</b>.")
            relationship_chart(paths)
