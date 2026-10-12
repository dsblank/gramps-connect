# =============================================================================
# Reacting to the Selected Record
# =============================================================================
# Shows extra detail about whichever record is currently open in this
# list's own detail pane -- the closest equivalent here to a Gramps
# Desktop sidebar gramplet reacting to the "active person". Works for
# whichever type this Gramplet is attached to (a single type, or "All" --
# isinstance(record, Person) etc. tells you which one you actually got).
#
# IMPORTANT: for this to update live as you click through the list, turn
# on "Re-run automatically when the selected record changes" (next to
# View, above the code box) in this Gramplet's own editor. Left off (the
# default), get_selected() still works, but only reflects whatever was
# selected the last time this Gramplet happened to run for some other
# reason (a tab switch, Execute, a tree-wide data change).
#
# Demonstrates:
#   - get_selected() -- None when nothing is selected (an empty list) or
#     when running from the standalone editor preview, which has no view
#     context at all; a real Gramps object otherwise, no separate
#     type+handle lookup needed, and no await to write (see autoAwait.ts).
#     One network fetch on the first call in a run, then memoized for the
#     rest of it -- but still worth calling once into a local, as below,
#     rather than sprinkling get_selected() through the code.
#   - isinstance(record, Person) to branch on what kind of record it is,
#     since a Gramplet attached to "All" views can be handed any of the
#     10 types -- safe to import Person/Family here (unlike some of
#     pyodideWorker.ts's own internal helpers, which deliberately avoid
#     isinstance to sidestep *forcing* gramps.gen.lib to load): by the
#     time get_selected() ever returns something, it has already loaded
#     gen.lib resolving that object, so this import is free, not a new cost.
#   - get_home_person() + db.get_relationship() -- the same
#     "Relationship to home person" Gramps desktop puts in its status bar
#   - Person Lookup's event-walk technique (every event, then every place,
#     one request each), plus the equivalent for a Family (parents and
#     children in one request)
# =============================================================================

from gramps.gen.lib import Family, Person

record = get_selected()

if record is None:
    print("Nothing selected -- click a row in the list (or turn on Execute) to see its detail here.")

elif isinstance(record, Person):
    person = record
    html(f"<h3>{name_of(person)}</h3>")

    # The Home person (set on the Home page) and how this person relates
    # to them. Argument order matters: the result describes the *second*
    # person in terms of the first, so this reads "person is home_person's
    # ...", the same direction Gramps desktop's status bar uses.
    # db.get_relationship() is None-safe (either argument may be None) but
    # is a real, server-side ancestor walk, so it stays inside the else --
    # no point paying for it just to find out the two are the same person.
    home_person = get_home_person()
    if home_person is None:
        print("No Home person set -- pick one on the Home page.")
    elif home_person.handle == person.handle:
        print("This is the Home person.")
    else:
        relationship = db.get_relationship(home_person, person)
        print(f"Relationship to Home person: {relationship or 'not related'}")

    # Same technique as Person Lookup: event_ref_list holds handles, not
    # the events themselves, so fetch every event in one request and then
    # every place they name in one more. "handle in [...]" needs at least
    # one handle, hence the "if"s.
    handles = [ref.ref for ref in person.event_ref_list]
    by_handle = {e.handle: e for e in events(f"handle in {handles!r}", limit=None)} if handles else {}
    place_handles = [e.place for e in by_handle.values() if e.place]
    place_of = {p.handle: p for p in places(f"handle in {place_handles!r}", limit=None)} if place_handles else {}
    set_column_titles("Role", "Type", "Date", "Place")
    for event_ref in person.event_ref_list:
        event = by_handle.get(event_ref.ref)
        if event is not None:
            row(str(event_ref.role), str(event.type), event.date, place_of.get(event.place))

elif isinstance(record, Family):
    family = record
    # Both parents and every child in one request.
    child_handles = [ref.ref for ref in family.child_ref_list]
    wanted = [h for h in [family.father_handle, family.mother_handle] + child_handles if h]
    members = {p.handle: p for p in people(f"handle in {wanted!r}", limit=None)} if wanted else {}
    father, mother = members.get(family.father_handle), members.get(family.mother_handle)

    set_column_titles("Role", "Person")
    row("Father", father)
    row("Mother", mother)

    html("<hr>")
    print(f"{len(family.child_ref_list)} child(ren):")
    set_column_titles("Child")
    for handle in child_handles:
        row(members.get(handle))

else:
    # Every other type (Event, Place, Source, ...) -- row() renders
    # `record` itself as the same clickable link a full
    # people()/families()/etc. result would.
    set_column_titles(type(record).__name__)
    row(record)
