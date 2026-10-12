person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    full_name = name_of(person)
    html(f"<h3>Event Coordinates for {full_name}</h3>")

    # Every family this person is a parent/spouse in -- a forward
    # reference on the person themselves (family_list), the same pattern
    # children uses, not a backlink search. Records are fetched one
    # request per kind (families, spouses, events, places), not one per
    # record; "handle in [...]" needs at least one handle, hence the "if"s.
    my_families = families(f"handle in {person.family_list!r}", limit=None) if person.family_list else []
    spouse_of = {
        f.handle: f.mother_handle if f.father_handle == person.handle else f.father_handle
        for f in my_families
    }
    spouse_handles = [h for h in spouse_of.values() if h]
    spouses = {p.handle: p for p in people(f"handle in {spouse_handles!r}", limit=None)} if spouse_handles else {}

    event_sources = [(ref.ref, full_name) for ref in person.event_ref_list]
    for family in my_families:
        spouse = spouses.get(spouse_of[family.handle])
        participant = name_of(spouse) if spouse else "Family"
        event_sources.extend((ref.ref, participant) for ref in family.event_ref_list)

    if not event_sources:
        html("<i>No events exist for this person or their families</i>")
    else:
        event_handles = [handle for handle, _ in event_sources]
        by_handle = {e.handle: e for e in events(f"handle in {event_handles!r}", limit=None)}
        place_handles = [e.place for e in by_handle.values() if e.place]
        place_of = {p.handle: p for p in places(f"handle in {place_handles!r}", limit=None)} if place_handles else {}

        # lat/long are stored as plain text ('' when not recorded) --
        # shown as-is, same as Gramps Desktop's own version of this
        # gramplet, rather than skipping rows with nothing recorded.
        set_column_titles("Event", "Participant", "Date", "Place", "Place ID", "Latitude", "Longitude")
        for handle, participant in event_sources:
            event = by_handle.get(handle)
            if event is None:
                continue
            place = place_of.get(event.place)
            row(
                event,
                participant,
                event.date,
                place if place else "",
                place.gramps_id if place else "",
                place.lat if place else "",
                place.long if place else "",
            )
