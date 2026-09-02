person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>To Do for {full_name}</h3>")

    from gramps.gen.lib import NoteType

    todo_notes = []
    for note_handle in person.note_list:
        note = db.get_note_from_handle(note_handle)
        if note.type == NoteType.TODO:
            todo_notes.append(note)

    if todo_notes:
        set_column_titles("To Do", "Text")
        for note in todo_notes:
            snippet = note.text.string.strip().replace("\n", " ")
            if len(snippet) > 200:
                snippet = snippet[:200] + "..."
            row(note, snippet)
    else:
        html("<i>No To Do notes recorded for this person</i>")
