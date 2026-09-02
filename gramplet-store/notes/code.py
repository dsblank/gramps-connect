person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Notes for {full_name}</h3>")
    if person.note_list:
        set_column_titles("Note", "Type", "Text")
        for note_handle in person.note_list:
            note = db.get_note_from_handle(note_handle)
            snippet = note.text.string.strip().replace("\n", " ")
            if len(snippet) > 80:
                snippet = snippet[:80] + "..."
            row(note, str(note.type), snippet)
    else:
        html("<i>No notes exist for this person</i>")
