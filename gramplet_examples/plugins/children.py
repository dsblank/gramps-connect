# To use this, in the Gramplet Editor:
# 1. Enter a Name -- this is the tab label -- like "Children"
# 2. Enter a Description, like "The children of the selected person, with their birth and death dates"
# 3. Select View: Person
# 4. Turn on Re-run automatically
# 5. Place the following as Code:

person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Children of {full_name}</h3>")
    if not person.family_list:
        html("<i>This person is not a parent in any recorded family</i>")
    else:
        def event_ref_handle(a_person, ref_index):
            # birth_ref_index/death_ref_index is -1 when no such event is
            # recorded -- see 07_relationship_queries.py's birth_place()
            # for the same indirection over a single person. A plain `def`
            # can't contain the `await` the auto-await preprocessor would
            # insert for a db.*() call (only top-level code -- what this
            # whole script already runs as -- supports that), so this
            # helper only ever touches the person object already in hand,
            # never db itself; the two db.get_event_from_handle() calls
            # below stay inline in the loop instead.
            if ref_index < 0:
                return None
            return a_person.event_ref_list[ref_index].ref

        columns("Child", "Birth Date", "Death Date", "Spouse")
        for family_handle in person.family_list:
            family = db.get_family_from_handle(family_handle)
            spouse_handle = (
                family.mother_handle if family.father_handle == person.handle else family.father_handle
            )
            spouse = db.get_person_from_handle(spouse_handle) if spouse_handle else None
            for child_ref in family.child_ref_list:
                child = db.get_person_from_handle(child_ref.ref)

                # Not db.get_event_from_handle(...).date in one
                # expression -- with await inserted, `.date` would apply
                # to the call's result *before* await runs, not after
                # (the same reason 02_person_lookup.py's own event/place
                # lookups are always two separate statements), so the
                # event is resolved on its own line first.
                birth_handle = event_ref_handle(child, child.birth_ref_index)
                birth_date = None
                if birth_handle:
                    birth_event = db.get_event_from_handle(birth_handle)
                    birth_date = birth_event.date

                death_handle = event_ref_handle(child, child.death_ref_index)
                death_date = None
                if death_handle:
                    death_event = db.get_event_from_handle(death_handle)
                    death_date = death_event.date

                row(child, birth_date, death_date, spouse if spouse else "Unknown")
