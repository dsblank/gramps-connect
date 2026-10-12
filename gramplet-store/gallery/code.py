person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    html(f"<h3>Media for {name_of(person)}</h3>")
    if person.media_list:
        # Gramplet code has no network access of its own, so there is no
        # way to fetch and embed the actual image bytes here (unlike
        # Gramps Desktop's own Gallery gramplet, which shows thumbnails) --
        # a table of the attached records is the closest equivalent.
        # Every one of them in one request, not one per media record.
        handles = [ref.ref for ref in person.media_list]
        by_handle = {m.handle: m for m in media(f"handle in {handles!r}", limit=None)}
        set_column_titles("Media", "Description", "Type", "Path")
        for handle in handles:
            item = by_handle.get(handle)
            if item is not None:
                row(item, item.desc, item.mime, item.path)
    else:
        html("<i>No media exist for this person</i>")
