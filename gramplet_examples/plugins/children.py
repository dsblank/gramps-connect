# To use this, in the Gramplet Editor:
# 1. Enter a title, like "Children"
# 2. Select View: Person
# 3. Turn on Re-run automatically
# 4. Place the following as Code:

if selected is None:
    print("<i>A person is not selected</i>")
else:
    person = selected
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Children of {full_name}</h3>")
    if not person.family_list:
        html("<i>This person is not a parent in any recorded family</i>")
    else:
        def event_date(a_person, ref_index):
            # birth_ref_index/death_ref_index is -1 when no such event is
            # recorded -- see 07_relationship_queries.py's birth_place()
            # for the same indirection over a single person.
            if ref_index < 0:
                return None
            return db.get_event_from_handle(a_person.event_ref_list[ref_index].ref).date

        columns("Child", "Birth Date", "Death Date", "Spouse")
        for family_handle in person.family_list:
            family = db.get_family_from_handle(family_handle)
            spouse_handle = (
                family.mother_handle if family.father_handle == person.handle else family.father_handle
            )
            spouse = db.get_person_from_handle(spouse_handle) if spouse_handle else None
            for child_ref in family.child_ref_list:
                child = db.get_person_from_handle(child_ref.ref)
                row(
                    child,
                    event_date(child, child.birth_ref_index),
                    event_date(child, child.death_ref_index),
                    spouse if spouse else "Unknown",
                )
