#
# The plural companion to relationship.py in this same folder: that one
# shows the single most direct relationship (what Gramps Desktop's status
# bar shows), this one shows every distinct path, with the common
# ancestors each goes through.
#
# Two people can be related more than one way at once. The clearest case
# isn't exotic: someone who is both a spouse AND a blood relative -- two
# cousins who married -- comes back as two entries, because the
# calculator appends the spouse relationship first and then the blood
# paths. Descent from one ancestor down two separate lines does it too.
# On ordinary data this is a one-row table saying exactly what
# relationship.py already said, so prefer that one unless you actually
# want every path: this is the more expensive call of the two, since it
# can't stop at the first answer it finds.

person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    home_person = get_home_person()
    if home_person is None:
        html("<i>No Home person set -- pick one on the Home page</i>")
    elif home_person.handle == person.handle:
        html("<i>This is your Home person</i>")
    else:
        # Same direction as db.get_relationship(): each string describes
        # the second person in terms of the first, so these read "the
        # selected person is the Home person's ...".
        #
        # There is no way to ask the server for just the first few -- the
        # endpoint takes depth and nothing else -- so slice the list here
        # if a very tangled pair ever produces more rows than you want.
        entries = db.get_relationships(home_person, person)

        if not entries:
            # depth defaults to 15 generations; pass e.g. depth=25 above
            # for a tree deep enough that the common ancestor is further
            # back than that.
            html("<i>No relationship found</i>")
        else:
            set_column_titles("Relationship", "Through common ancestor")
            for entry in entries:
                # Handles, not resolved objects -- the same convention
                # get_backlinks() uses, so the ones actually displayed get
                # looked up here. A relationship the calculator found by
                # more than one path is a single entry with several
                # ancestors (it merges paths that come out with identical
                # wording), so this is one row per ancestor with the
                # relationship named only on the first of them, rather
                # than one row per entry.
                #
                # An empty list is normal, not missing data: a spouse or
                # other non-blood relation has no common ancestor at all.
                ancestors = entry["common_ancestors"]
                if not ancestors:
                    row(entry["relationship_string"], "by marriage")
                else:
                    label = entry["relationship_string"]
                    for ancestor_handle in ancestors:
                        ancestor = db.get_person_from_handle(ancestor_handle)
                        row(label, ancestor)
                        label = ""
