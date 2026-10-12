person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    from gramps.gen.lib import EventRoleType, EventType, Person

    html(f"<h3>{name_of(person)}</h3>")

    print("Gramps ID:", person.gramps_id)
    gender_label = {Person.MALE: "Male", Person.FEMALE: "Female", Person.OTHER: "Other"}.get(
        person.gender, "Unknown"
    )
    print("Gender:", gender_label)

    if person.alternate_names:
        html("<h4>Alternate Names</h4>")
        set_column_titles("Name", "Type")
        for alt in person.alternate_names:
            row(name_of(alt), str(alt.type))

    # Only the first-recorded parent family, same as Gramps Desktop's own
    # Person Details gramplet -- a person can be a child in more than one
    # family (adoption, step-parents, ...), but this is meant as a quick
    # summary, not a full family list (see the Children plugin for that,
    # from the parent's side).
    if person.parent_family_list:
        family = db.get_raw_family_data(person.parent_family_list[0])
        # Both parents in one request.
        parent_handles = [h for h in (family.father_handle, family.mother_handle) if h]
        parents = {p.handle: p for p in people(f"handle in {parent_handles!r}")} if parent_handles else {}
        father, mother = parents.get(family.father_handle), parents.get(family.mother_handle)
        html("<h4>Parents</h4>")
        set_column_titles("Parent", "Name")
        row("Father", father if father else "Unknown")
        row("Mother", mother if mother else "Unknown")

    # Primary-role birth/baptism/death/burial only -- the same four events
    # Gramps Desktop's Person Details gramplet shows: the first of each
    # type, in the person's own event order. Every primary event in one
    # request, then their places in one more. These are records, not real
    # objects, so an event's type is compared by its .value.
    primary = [ref.ref for ref in person.event_ref_list if ref.role == EventRoleType.PRIMARY]
    by_handle = {e.handle: e for e in events(f"handle in {primary!r}", limit=None)} if primary else {}
    ordered = [by_handle[h] for h in primary if h in by_handle]
    life_events = []
    for event_type in (EventType.BIRTH, EventType.BAPTISM, EventType.DEATH, EventType.BURIAL):
        life_events += [e for e in ordered if e.type.value == event_type][:1]
    if life_events:
        place_handles = [e.place for e in life_events if e.place]
        place_of = {p.handle: p for p in places(f"handle in {place_handles!r}")} if place_handles else {}
        html("<h4>Life Events</h4>")
        set_column_titles("Event", "Date", "Place")
        for event in life_events:
            row(str(event.type), event.date, place_of.get(event.place))

    # The same three attributes Gramps Desktop's Person Details gramplet
    # singles out for display.
    attr_rows = []
    for label in ("Occupation", "Title", "Religion"):
        values = [attr.value for attr in person.attribute_list if str(attr.type) == label]
        if values:
            attr_rows.append((label, ", ".join(values)))
    if attr_rows:
        html("<h4>Attributes</h4>")
        set_column_titles("Attribute", "Value")
        for label, value in attr_rows:
            row(label, value)
