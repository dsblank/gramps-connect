person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    html(f"<h3>To Do for {name_of(person)}</h3>")

    # Only this person's To Do notes, picked out by the server in one
    # request rather than fetching every note to check its type here.
    # "handle in [...]" needs at least one handle, hence the "if".
    todo_notes = (
        notes(f"handle in {person.note_list!r} and type.value == NoteType.TODO", limit=None)
        if person.note_list
        else []
    )
    if todo_notes:
        order = {handle: i for i, handle in enumerate(person.note_list)}
        set_column_titles("To Do", "Text")
        for note in sorted(todo_notes, key=lambda n: order[n.handle]):
            snippet = note.text.string.strip().replace("\n", " ")
            if len(snippet) > 200:
                snippet = snippet[:200] + "..."
            row(note, snippet)
    else:
        html("<i>No To Do notes recorded for this person</i>")
