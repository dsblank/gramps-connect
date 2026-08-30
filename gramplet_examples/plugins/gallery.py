# To use this, in the Gramplet Editor:
# 1. Enter a Name -- this is the tab label -- like "Gallery"
# 2. Enter a Description, like "The media records attached to the selected person"
# 3. Select View: Person
# 4. Turn on Re-run automatically
# 5. Place the following as Code:

person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Media for {full_name}</h3>")
    if person.media_list:
        # Gramplet code has no network access of its own, so there is no
        # way to fetch and embed the actual image bytes here (unlike
        # Gramps Desktop's own Gallery gramplet, which shows thumbnails) --
        # a table of the attached records is the closest equivalent.
        columns("Media", "Description", "Type", "Path")
        for media_ref in person.media_list:
            media = db.get_media_from_handle(media_ref.ref)
            row(media, media.desc, media.mime, media.path)
    else:
        html("<i>No media exist for this person</i>")
