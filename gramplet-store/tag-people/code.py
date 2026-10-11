# =============================================================================
# Tag People
# =============================================================================
# Adds the tag you choose to everyone in the People list's current filter.
# Nothing happens until you pick a tag, and without a filter it does nothing
# at all, so it can't tag the whole tree by accident.
#
# This Gramplet changes data, so it has Allow data changes turned on.
# Opening its window (or picking another tag) is a dry run: the yellow box
# below the output lists everyone it would tag, and nothing is saved. Click
# Run to save it -- all in one transaction, which Undo takes back.
#
# Demonstrates:
#   - adding to a list in a record: person.tag_list.append(handle) -- a
#     record stores its tags as tag handles, not names
#   - st.selectbox() with a "choose one" entry, so nothing is picked for you
#   - no begin_changes()/end_changes(): without them, the whole run is one
#     group of changes, named after the Gramplet
# =============================================================================

PICK = "-- Choose a tag --"

where = get_filter("person")
all_tags = tags(limit=None)
if not where:
    st.info("Filter the People list to the people you want to tag, then run this again.")
elif not all_tags:
    st.info("This tree has no tags yet. Create one first.")
else:
    # The dropdown shows each option as text, so offer names, not records.
    # Two tags can share a name; number the repeats so each can be picked.
    by_name = {}
    for tag in sorted(all_tags, key=lambda tag: tag.name.lower()):
        label, n = tag.name, 1
        while label in by_name:
            n += 1
            label = f"{tag.name} ({n})"
        by_name[label] = tag
    name = st.selectbox("Tag to add", [PICK] + list(by_name))
    if name == PICK:
        st.info("Choose a tag to add.")
    else:
        tag = by_name[name]
        # Only each person's tags come back from filter() -- cheap -- so the
        # people who already have the tag are skipped without fetching them.
        matches = filter("person", where=where, what=["tag_list"], limit=None)
        untagged = [p["handle"] for p in matches if tag.handle not in (p["tag_list"] or [])]
        if not untagged:
            st.success(f"Everyone in the filter already has the tag {name}.")
        else:
            bar = st.progress(0, text=f"Tagging {len(untagged)} people...")
            for i, handle in enumerate(untagged):
                bar.progress((i + 1) / len(untagged), text=f"Tagging {len(untagged)} people...")
                person = get_raw_object("person", handle)
                person.tag_list.append(tag.handle)
            bar.empty()
            st.info(f"{len(untagged)} of {len(matches)} people in the filter get the tag {name} -- see the list below.")
