# To use this, in the Gramplet Editor:
# 1. Enter a title, like "Events"
# 2. Select View: Person
# 3. Turn on Re-run automatically
# 4. Place the following as Code:

if selected is None:
    html("<i>A person is not selected</i>")
else:
    person = selected
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Events for {full_name}</h3>")
    if person.event_ref_list:
        columns("Event", "Role", "Type", "Date", "Place")
        for event_ref in person.event_ref_list:
            event = db.get_event_from_handle(event_ref.ref)
            place = db.get_place_from_handle(event.place) if event.place else None
            row(event, str(event_ref.role), str(event.type), event.date, place)
    else:
        html("<i>No events exist for this person</i>")
