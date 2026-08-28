# =============================================================================
# 07 - Crossing Relationships
# =============================================================================
# A "where" condition can reach one hop across a relationship -- a
# person's birth event, a family's father, an event's place -- to filter
# on, even though people()/families()/etc. themselves always return a
# whole, unrelated object with no way to ask for a related field back
# directly (that's a deliberately internal capability of the lower-level
# function they're built on, not part of the public API -- see
# 04_interactive_search.py's own comment on why). Getting a related
# field back for *display* is instead the same by-hand lookup
# 02_person_lookup.py already shows: read this file after that one.
#
# Demonstrates:
#   - a dotted "where" condition crossing a relationship
#   - resolving a related field for display via db's own methods, the
#     same handle-indirection technique as 02_person_lookup.py
#   - exists(...)/count(...) over a one-to-many collection (events,
#     children, citations, ...)
# =============================================================================

# "birth.place.title" crosses two relationships: person -> birth event ->
# place. Anything reachable in the where= grammar (see the (i) help
# button's field reference for exactly which relationships each type has)
# can be crossed the same way in a where= condition -- this works today
# exactly because it only needs a condition to be true or false, not a
# value handed back.
born_and_died_same_place = people(
    "birth.place.title == death.place.title and birth.place.title is not None",
    order=[{"column": "surname", "direction": "asc"}],
    limit=50,
)


def birth_place(person):
    # birth_ref_index is -1 when no birth event is recorded; otherwise
    # it's this person's own index into event_ref_list for their birth --
    # the same indirection 02_person_lookup.py walks for every event, just
    # narrowed to the one we already know we want.
    if person.birth_ref_index < 0:
        return None
    event = db.get_event_from_handle(person.event_ref_list[person.birth_ref_index].ref)
    return db.get_place_from_handle(event.place) if event.place else None


columns("Person", "Birth & death place")
for person in born_and_died_same_place:
    # A Place object renders as a clickable link too, same as person does
    # -- row() special-cases any primary Gramps object, not just Person.
    row(person, birth_place(person))

# ---- exists()/count() over a collection -----------------------------------
# Not every relationship is one-to-one (a person has exactly one birth
# event, but any number of other events/citations/children/...) -- those
# are "collections", usable with exists(...) or count(...) but never as a
# plain dotted path on their own.
html("<hr>")
print("People with at least one high-confidence citation but no notes:")
well_sourced_undocumented = people(
    "exists(citations, confidence >= Citation.CONF_HIGH) and not exists(notes)",
    limit=25,
)
columns("Person")
for person in well_sourced_undocumented:
    row(person)

html("<hr>")
print("Families with more than 4 children:")
large_families = families("count(children) > 4", limit=25)
columns("Family", "Children")
for family in large_families:
    row(family, len(family.child_ref_list))
