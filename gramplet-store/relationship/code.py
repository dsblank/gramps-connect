#
# The same thing Gramps Desktop puts in its status bar ("Relationship to
# home person"), as a Person gramplet. Two pieces of run context and one
# call: get_selected() is the row open in the detail pane, get_home_person()
# is whoever is set as Home person on the Home page, and
# db.get_relationship() asks gramps-web-api's own /relations/ endpoint --
# which runs the real gramps.gen.relationship calculator server-side, so
# this gets desktop's exact wording ("second cousin once removed") without
# reimplementing any of it here.

person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    home_person = get_home_person()
    if home_person is None:
        # Nobody has set one yet: it's a per-browser preference (the Home
        # page's own Home person card), not something stored in the tree,
        # so this is the normal state on a browser that has never picked
        # one -- worth saying plainly rather than showing an empty table.
        html("<i>No Home person set -- pick one on the Home page</i>")
    elif home_person.handle == person.handle:
        html("<i>This is your Home person</i>")
    else:
        name = person.primary_name
        full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
        home_name = home_person.primary_name
        home_full_name = (
            f"{home_name.first_name} {' '.join(s.surname for s in home_name.surname_list)}".strip()
        )

        # Argument order is what makes this read the right way round: the
        # result describes the *second* person in terms of the first, so
        # (home_person, person) gives "son"/"niece"/... meaning the
        # selected person is the Home person's son/niece. Same direction
        # Gramps Desktop's own status bar uses.
        #
        # None comes back when the two genuinely aren't related within the
        # search depth -- pass e.g. depth=25 for a tree deep enough that
        # the default 15 generations isn't reaching a common ancestor.
        # Spouses and other non-blood relations DO get a string ("wife"),
        # even though they have no common ancestor at all.
        relationship = db.get_relationship(home_person, person)

        columns("Home person", "Relationship")
        row(home_person, relationship or "Not related")

        if relationship:
            html(f"{full_name} is {home_full_name}'s {relationship}.")
        else:
            html(f"No relationship found between {full_name} and {home_full_name}.")
