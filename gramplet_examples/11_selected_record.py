# =============================================================================
# 11 - Reacting to the Selected Record
# =============================================================================
# Shows extra detail about whichever record is currently open in this
# list's own detail pane -- the closest equivalent here to a Gramps
# Desktop sidebar gramplet reacting to the "active person". Works for
# whichever type this Gramplet is attached to (a single type, or "All" --
# isinstance(selected, Person) etc. tells you which one you actually got).
#
# IMPORTANT: for this to update live as you click through the list, turn
# on "Re-run automatically when the selected record changes" (next to
# View, above the code box) in this Gramplet's own editor. Left off (the
# default), `selected` still works, but only reflects whatever was
# selected the last time this Gramplet happened to run for some other
# reason (a tab switch, Execute, a tree-wide data change).
#
# Demonstrates:
#   - selected -- None when nothing is selected (an empty list) or when
#     running from the standalone editor preview, which has no view
#     context at all; already a real Gramps object otherwise, no separate
#     type+handle lookup needed
#   - isinstance(selected, Person) to branch on what kind of record it is,
#     since a Gramplet attached to "All" views can be handed any of the
#     10 types -- safe to import Person/Family here (unlike some of
#     pyodideWorker.ts's own internal helpers, which deliberately avoid
#     isinstance to sidestep *forcing* gramps.gen.lib to load): by the
#     time selected is ever not None, get_object() already loaded it
#     resolving selected itself, so this import is free, not a new cost.
#   - reusing 02_person_lookup.py's by-hand event-walk technique, plus the
#     equivalent for a Family (parents/children instead of events)
# =============================================================================

from gramps.gen.lib import Family, Person

if selected is None:
    print("Nothing selected -- click a row in the list (or turn on Execute) to see its detail here.")

elif isinstance(selected, Person):
    person = selected
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>{full_name}</h3>")

    # Same handle-indirection technique as 02_person_lookup.py: event_ref_
    # list holds handles, not the events themselves.
    columns("Role", "Type", "Date", "Place")
    for event_ref in person.event_ref_list:
        event = db.get_event_from_handle(event_ref.ref)
        place = db.get_place_from_handle(event.place) if event.place else None
        row(str(event_ref.role), str(event.type), event.date, place)

elif isinstance(selected, Family):
    family = selected
    father = db.get_person_from_handle(family.father_handle) if family.father_handle else None
    mother = db.get_person_from_handle(family.mother_handle) if family.mother_handle else None

    columns("Role", "Person")
    row("Father", father)
    row("Mother", mother)

    html("<hr>")
    print(f"{len(family.child_ref_list)} child(ren):")
    columns("Child")
    for child_ref in family.child_ref_list:
        row(db.get_person_from_handle(child_ref.ref))

else:
    # Every other type (Event, Place, Source, ...) -- row() renders
    # `selected` itself as the same clickable link a full
    # people()/families()/etc. result would.
    columns(type(selected).__name__)
    row(selected)
