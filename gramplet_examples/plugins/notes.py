# To use this, in the Gramplet Editor:
# 1. Enter a title, like "Notes"
# 2. Select View: Person
# 3. Turn on Re-run automatically
# 4. Place the following as Code:

if selected is None:
    html("<i>A person is not selected</i>")
else:
    person = selected
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Notes for {full_name}</h3>")
    if person.note_list:
        columns("Note", "Type", "Text")
        for note_handle in person.note_list:
            note = db.get_note_from_handle(note_handle)
            snippet = note.text.string.strip().replace("\n", " ")
            if len(snippet) > 80:
                snippet = snippet[:80] + "..."
            row(note, str(note.type), snippet)
    else:
        html("<i>No notes exist for this person</i>")
