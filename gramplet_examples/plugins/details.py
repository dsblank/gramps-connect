# To use this, in the Gramplet Editor:
# 1. Enter a title, like "Details"
# 2. Select View: Person
# 3. Turn on Re-run automatically
# 4. Place the following as Code:

if selected is None:
    html("<i>A person is not selected</i>")
else:
    person = selected
    from gramps.gen.lib import EventRoleType, EventType, Person

    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>{full_name}</h3>")

    print("Gramps ID:", person.gramps_id)
    gender_label = {Person.MALE: "Male", Person.FEMALE: "Female", Person.OTHER: "Other"}.get(
        person.gender, "Unknown"
    )
    print("Gender:", gender_label)

    if person.alternate_names:
        html("<h4>Alternate Names</h4>")
        columns("Name", "Type")
        for alt in person.alternate_names:
            alt_name = f"{alt.first_name} {' '.join(s.surname for s in alt.surname_list)}".strip()
            row(alt_name, str(alt.type))

    # Only the first-recorded parent family, same as Gramps Desktop's own
    # Person Details gramplet -- a person can be a child in more than one
    # family (adoption, step-parents, ...), but this is meant as a quick
    # summary, not a full family list (see the Children plugin for that,
    # from the parent's side).
    if person.parent_family_list:
        family = db.get_family_from_handle(person.parent_family_list[0])
        father = db.get_person_from_handle(family.father_handle) if family.father_handle else None
        mother = db.get_person_from_handle(family.mother_handle) if family.mother_handle else None
        html("<h4>Parents</h4>")
        columns("Parent", "Name")
        row("Father", father if father else "Unknown")
        row("Mother", mother if mother else "Unknown")

    # Primary-role birth/baptism/death/burial only -- the same four events
    # Gramps Desktop's Person Details gramplet shows.
    def primary_event(event_type):
        for event_ref in person.event_ref_list:
            if event_ref.role == EventRoleType.PRIMARY:
                event = db.get_event_from_handle(event_ref.ref)
                if event.type == event_type:
                    return event
        return None

    life_events = []
    for event_type in (EventType.BIRTH, EventType.BAPTISM, EventType.DEATH, EventType.BURIAL):
        event = primary_event(event_type)
        if event:
            life_events.append(event)
    if life_events:
        html("<h4>Life Events</h4>")
        columns("Event", "Date", "Place")
        for event in life_events:
            place = db.get_place_from_handle(event.place) if event.place else None
            row(str(event.type), event.date, place)

    # The same three attributes Gramps Desktop's Person Details gramplet
    # singles out for display.
    attr_rows = []
    for label in ("Occupation", "Title", "Religion"):
        values = [attr.value for attr in person.attribute_list if str(attr.type) == label]
        if values:
            attr_rows.append((label, ", ".join(values)))
    if attr_rows:
        html("<h4>Attributes</h4>")
        columns("Attribute", "Value")
        for label, value in attr_rows:
            row(label, value)
