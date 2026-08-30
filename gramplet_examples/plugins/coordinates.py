# To use this, in the Gramplet Editor:
# 1. Enter a Name -- this is the tab label -- like "Coordinates"
# 2. Enter a Description, like "Latitude and longitude of every place the selected person has an event at"
# 3. Select View: Person
# 4. Turn on Re-run automatically
# 5. Place the following as Code:

if selected is None:
    html("<i>A person is not selected</i>")
else:
    person = selected
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Event Coordinates for {full_name}</h3>")

    event_sources = [(event_ref, full_name) for event_ref in person.event_ref_list]

    # Every family this person is a parent/spouse in -- a forward
    # reference on the person themselves (family_list), the same pattern
    # children.py uses, not a backlink search.
    for family_handle in person.family_list:
        family = db.get_family_from_handle(family_handle)
        spouse_handle = (
            family.mother_handle if family.father_handle == person.handle else family.father_handle
        )
        if spouse_handle:
            spouse = db.get_person_from_handle(spouse_handle)
            spouse_name = spouse.primary_name
            participant = (
                f"{spouse_name.first_name} {' '.join(s.surname for s in spouse_name.surname_list)}".strip()
            )
        else:
            participant = "Family"
        event_sources.extend((event_ref, participant) for event_ref in family.event_ref_list)

    if not event_sources:
        html("<i>No events exist for this person or their families</i>")
    else:
        # lat/long are stored as plain text ('' when not recorded) --
        # shown as-is, same as Gramps Desktop's own version of this
        # gramplet, rather than skipping rows with nothing recorded.
        columns("Event", "Participant", "Date", "Place", "Place ID", "Latitude", "Longitude")
        for event_ref, participant in event_sources:
            event = db.get_event_from_handle(event_ref.ref)
            place = db.get_place_from_handle(event.place) if event.place else None
            row(
                event,
                participant,
                event.date,
                place if place else "",
                place.gramps_id if place else "",
                place.lat if place else "",
                place.long if place else "",
            )
