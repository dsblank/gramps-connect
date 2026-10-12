person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    html(f"<h3>Other records referring to {name_of(person)}</h3>")

    # {"family": [handle, ...], "citation": [...], ...} -- one real network
    # round trip, backed by the tree's own reverse-reference index
    # server-side (gramps-web-api's find_backlink_handles()), not a scan
    # over every object of every type.
    backlinks = db.get_person_backlinks(person.handle)

    if not backlinks:
        html("<i>Nothing else in the tree refers to this person</i>")
    else:
        # Which types turn up depends on the person (a Family as father/
        # mother/child, another Person's association, ...), so each type's
        # records are fetched by looking its plural function up by name --
        # one request per type, not one per record. A function picked
        # dynamically like this isn't recognized by the auto-await
        # preprocessor (it only rewrites literal people(...) etc. call
        # sites in the source text), so `await` is written by hand here.
        fetch = {
            "person": people, "family": families, "event": events, "place": places,
            "source": sources, "citation": citations, "repository": repositories,
            "media": media, "note": notes, "tag": tags,
        }
        set_column_titles("Type", "Record")
        for obj_type, handles in backlinks.items():
            if handles:
                for record in await fetch[obj_type](f"handle in {handles!r}", limit=None):
                    row(obj_type.capitalize(), record)
