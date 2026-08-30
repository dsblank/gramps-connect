# To use this, in the Gramplet Editor:
# 1. Enter a Name -- this is the tab label -- like "Backlinks"
# 2. Enter a Description, like "Every other record in the tree that refers to the selected person"
# 3. Select View: Person
# 4. Turn on Re-run automatically
# 5. Place the following as Code:

if selected is None:
    html("<i>A person is not selected</i>")
else:
    person = selected
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Other records referring to {full_name}</h3>")

    # {"family": [handle, ...], "citation": [...], ...} -- one real network
    # round trip, backed by the tree's own reverse-reference index
    # server-side (gramps-web-api's find_backlink_handles()), not a scan
    # over every object of every type.
    backlinks = db.get_person_backlinks(person.handle)

    if not backlinks:
        html("<i>Nothing else in the tree refers to this person</i>")
    else:
        columns("Type", "Record")
        for obj_type, handles in backlinks.items():
            # obj_type is picked dynamically (a Person can be referred to by
            # a Family as father/mother/child, or by another Person's own
            # association), so the resolver method is looked up by name --
            # db.get_<type>_from_handle for whichever types actually turn
            # up. A dynamically-looked-up method isn't recognized by the
            # auto-await preprocessor (it only rewrites literal db.foo(...)
            # call sites in the source text), so `await` is written by hand
            # here.
            get_from_handle = getattr(db, f"get_{obj_type}_from_handle")
            for handle in handles:
                obj = await get_from_handle(handle)
                row(obj_type.capitalize(), obj)
