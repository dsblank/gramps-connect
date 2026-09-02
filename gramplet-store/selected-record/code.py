# =============================================================================
# 11 - Reacting to the Selected Record
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
#   - reusing 02_person_lookup.py's by-hand event-walk technique, plus the
#     equivalent for a Family (parents/children instead of events)
# =============================================================================

from gramps.gen.lib import Family, Person

record = get_selected()

if record is None:
    print("Nothing selected -- click a row in the list (or turn on Execute) to see its detail here.")

elif isinstance(record, Person):
    person = record
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>{full_name}</h3>")

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

    # Same handle-indirection technique as 02_person_lookup.py: event_ref_
    # list holds handles, not the events themselves.
    set_column_titles("Role", "Type", "Date", "Place")
    for event_ref in person.event_ref_list:
        event = db.get_event_from_handle(event_ref.ref)
        place = db.get_place_from_handle(event.place) if event.place else None
        row(str(event_ref.role), str(event.type), event.date, place)

elif isinstance(record, Family):
    family = record
    father = db.get_person_from_handle(family.father_handle) if family.father_handle else None
    mother = db.get_person_from_handle(family.mother_handle) if family.mother_handle else None

    set_column_titles("Role", "Person")
    row("Father", father)
    row("Mother", mother)

    html("<hr>")
    print(f"{len(family.child_ref_list)} child(ren):")
    set_column_titles("Child")
    for child_ref in family.child_ref_list:
        row(db.get_person_from_handle(child_ref.ref))

else:
    # Every other type (Event, Place, Source, ...) -- row() renders
    # `record` itself as the same clickable link a full
    # people()/families()/etc. result would.
    set_column_titles(type(record).__name__)
    row(record)
