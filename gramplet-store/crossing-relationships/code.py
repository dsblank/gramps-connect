# =============================================================================
# Crossing Relationships
# =============================================================================
# A "where" condition can reach across relationships -- a person's birth
# event, a family's father, an event's place -- to filter on. what= can
# reach across them the same way to hand a related field back
# ("birth.place" is the handle of the birth event's place), without
# fetching the birth event itself.
#
# Demonstrates:
#   - a dotted "where" condition crossing a relationship
#   - a dotted what= field crossing one, to get a related value back
#   - any(...)/len(...) over a one-to-many collection (events,
#     children, citations, ...)
# =============================================================================

# "birth.place.title" crosses two relationships: person -> birth event ->
# place. Anything reachable in the where= grammar (see the (i) help
# button's field reference for exactly which relationships each type has)
# can be crossed the same way in a where= condition -- this works today
# exactly because it only needs a condition to be true or false, not a
# value handed back.
#
# and_filters(get_filter(), ...) layers this on top of whatever filter is
# currently applied on the People view this Gramplet is a tab of, so the
# two person queries below only look within the filtered list rather than
# always the whole tree -- see the manifest's listensToFilter. The
# families() query further down stays untouched: get_filter() here is a
# Person where_expr (this Gramplet's views is ["person"]), which doesn't
# apply to a Family query.
born_and_died_same_place = people(
    and_filters(get_filter(), "birth.place.title == death.place.title and birth.place.title is not None"),
    order=[{"column": "surname", "direction": "asc"}],
    limit=50,
)

# Each one's birth place handle, through their birth event, in one request
# -- then the places themselves in one more. "handle in [...]" needs at
# least one handle, hence the "if"s.
handles = [p.handle for p in born_and_died_same_place]
birth_place_of = (
    {r.handle: r["birth.place"] for r in filter("person", where=f"handle in {handles!r}", what=["birth.place"], limit=None)}
    if handles
    else {}
)
place_handles = [h for h in birth_place_of.values() if h]
place_of = {p.handle: p for p in places(f"handle in {place_handles!r}", limit=None)} if place_handles else {}

set_column_titles("Person", "Birth & death place")
for person in born_and_died_same_place:
    # A place renders as a clickable link too, same as a person does --
    # row() special-cases any primary Gramps record, not just Person.
    row(person, place_of.get(birth_place_of.get(person.handle)))

# ---- any()/len() over a collection -----------------------------------
# Not every relationship is one-to-one (a person has exactly one birth
# event, but any number of other events/citations/children/...) -- those
# are "collections", usable with any(...) or len(...) but never as a
# plain dotted path on their own.
html("<hr>")
print("People with at least one high-confidence citation but no notes:")
well_sourced_undocumented = people(
    and_filters(
        get_filter(),
        "any(c.confidence >= Citation.CONF_HIGH for c in citations) and not any(n for n in notes)",
    ),
    limit=25,
)
set_column_titles("Person")
for person in well_sourced_undocumented:
    row(person)

html("<hr>")
print("Families with more than 4 children:")
large_families = families("len([c for c in children]) > 4", limit=25)
set_column_titles("Family", "Children")
for family in large_families:
    row(family, len(family.child_ref_list))
