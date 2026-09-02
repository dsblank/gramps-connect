# =============================================================================
# 03 - Tree Statistics
# =============================================================================
# A quick "how big is this tree?" summary -- one row per record type, plus
# a couple of derived numbers computed from cheap count() queries rather
# than downloading every record just to count them.
#
# Demonstrates:
#   - db.get_number_of_<type>() -- a cheap count, no records downloaded
#   - count(object_type, where=...) -- the same thing with a filter
#   - plain Python (a list of tuples, an f-string, a percentage) working
#     exactly like it would in any other script
# =============================================================================

# One count() call per record type -- each is cheap (the match total comes
# back in a response header; no records are actually downloaded to produce
# it), so this whole dashboard is 10-ish small requests, not one that
# downloads the tree.
counts = [
    ("People", db.get_number_of_people()),
    ("Families", db.get_number_of_families()),
    ("Events", db.get_number_of_events()),
    ("Places", db.get_number_of_places()),
    ("Sources", db.get_number_of_sources()),
    ("Citations", db.get_number_of_citations()),
    ("Repositories", db.get_number_of_repositories()),
    ("Media", db.get_number_of_media()),
    ("Notes", db.get_number_of_notes()),
]

set_column_titles("Record type", "Count")
for label, total in counts:
    row(label, total)

# count(object_type, where=...) rather than a db method: db's own get_
# number_of_*() methods (above) always count the whole tree, with no
# where= parameter -- there's no db equivalent for a *conditional* count,
# so this is the one place in these examples where reaching past db's own
# methods is the only option, not a shortcut around them.
total_people = db.get_number_of_people()
women = count("person", where="gender == Person.FEMALE")
men = count("person", where="gender == Person.MALE")
no_birth_date = count("person", where="birth.date.sortval is None")

html("<hr>")
print(f"Total people: {total_people}")
if total_people:
    print(f"  Female: {women} ({women / total_people:.0%})")
    print(f"  Male:   {men} ({men / total_people:.0%})")
    print(f"  Missing a recorded birth date: {no_birth_date} ({no_birth_date / total_people:.0%})")
