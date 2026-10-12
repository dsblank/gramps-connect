person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    html(f"<h3>Events for {name_of(person)}</h3>")
    if person.event_ref_list:
        # Every event, then every place they happened at: one request
        # each, not one per record. "handle in [...]" needs at least one
        # handle, hence the "if".
        handles = [ref.ref for ref in person.event_ref_list]
        by_handle = {e.handle: e for e in events(f"handle in {handles!r}", limit=None)}
        place_handles = [e.place for e in by_handle.values() if e.place]
        place_of = {p.handle: p for p in places(f"handle in {place_handles!r}", limit=None)} if place_handles else {}

        set_column_titles("Event", "Role", "Type", "Date", "Place")
        for event_ref in person.event_ref_list:
            event = by_handle.get(event_ref.ref)
            if event is not None:
                row(event, str(event_ref.role), str(event.type), event.date, place_of.get(event.place))
    else:
        html("<i>No events exist for this person</i>")
