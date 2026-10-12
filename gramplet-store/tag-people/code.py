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
    by_name = {tag.name: tag for tag in all_tags}
    name = st.selectbox("Tag to add", [PICK] + sorted(by_name, key=str.lower))
    if name == PICK:
        st.info("Choose a tag to add.")
    else:
        tag = by_name[name]
        # The server picks out the people in the filter who don't have the
        # tag yet, and people() hands them back as whole records, ready to
        # change -- one request, however many there are.
        total = count("person", where=where)
        untagged = people(and_filters(where, f"not any(tags, handle == {tag.handle!r})"), limit=None)
        if not untagged:
            st.success(f"Everyone in the filter already has the tag {name}.")
        else:
            for person in untagged:
                person.tag_list.append(tag.handle)
            st.info(f"{len(untagged)} of {total} people in the filter get the tag {name} -- see the list below.")
