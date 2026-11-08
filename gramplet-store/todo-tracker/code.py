# =============================================================================
# Research To-Do Tracker
# =============================================================================
# Lists research notes (Note.type == NoteType.RESEARCH) and lets you
# toggle between "only ones mentioning TODO" and "all research notes"
# with a checkbox -- a small, useful research-tracking Gramplet, and a
# second worked example of the st.checkbox() + dynamic "where" pattern
# from People Search, this time over Notes instead of People.
#
# Demonstrates:
#   - collections/tags: any(t.name == '...' for t in tags)
#   - a Note's own type field (NoteType.RESEARCH, .TODO, ...)
#   - combining a widget's value into a "where" string built from fixed
#     pieces (safe here with no f-string, since nothing is user-typed --
#     contrast with People Search's repr()-quoted surname,
#     needed there because that value *is* user-typed)
# =============================================================================

todo_only = st.checkbox("Only notes mentioning TODO", value=True)

# and_filters(get_filter(), ...) layers this on top of whatever filter is
# currently applied on the Notes view this Gramplet is a tab of, so this
# tracker only lists research notes within that filter -- see the
# manifest's listensToFilter.
where = and_filters(
    get_filter(),
    "type.value == NoteType.RESEARCH",
    "'TODO' in text.string" if todo_only else None,
)

matching_notes = notes(where, order=[{"column": "change", "direction": "desc"}], limit=100)

st.write(f"{len(matching_notes)} research note(s)")

# A Note's own tag_list holds handles, not the tags themselves -- the same
# handle-indirection event_ref_list uses. Every tag these notes use, in one
# request ("handle in [...]" needs at least one handle, hence the "if").
tag_handles = sorted({h for note in matching_notes for h in note.tag_list})
tag_name = {t.handle: t.name for t in tags(f"handle in {tag_handles!r}", limit=None)} if tag_handles else {}

set_column_titles("Note", "Tags", "Text")
for note in matching_notes:
    tag_names = [tag_name[h] for h in note.tag_list if h in tag_name]

    # note.text is a StyledText object (Gramps supports bold/italic runs
    # within a note); .string is its plain-text content with no markup.
    # (row(note) alone already shows a short auto-generated snippet -- see
    # Hello Table's comment on row() and records -- this one is
    # deliberately longer, which is why it's worth its own column here.)
    snippet = note.text.string.strip().replace("\n", " ")
    if len(snippet) > 80:
        snippet = snippet[:80] + "..."

    row(note, ", ".join(tag_names) or "(none)", snippet)
