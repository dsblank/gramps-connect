person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    html(f"<h3>Notes for {name_of(person)}</h3>")
    if person.note_list:
        # Every note in one request, not one per note.
        by_handle = {n.handle: n for n in notes(f"handle in {person.note_list!r}", limit=None)}
        set_column_titles("Note", "Type", "Text")
        for handle in person.note_list:
            note = by_handle.get(handle)
            if note is None:
                continue
            snippet = note.text.string.strip().replace("\n", " ")
            if len(snippet) > 80:
                snippet = snippet[:80] + "..."
            row(note, str(note.type), snippet)
    else:
        html("<i>No notes exist for this person</i>")
