# =============================================================================
# Mark Unsourced People Private
# =============================================================================
# Finds the same people as People Without Sources -- no citation on the
# person themselves, on any of their event references, or on any of their
# events -- and marks the ones that are still public as private.
#
# This Gramplet changes data, so it has Allow data changes turned on.
# Opening its window is a dry run: the yellow box below the output lists
# everyone it would change, and nothing is saved. Click Run to save it --
# all in one transaction, which Undo takes back.
#
# Demonstrates:
#   - changing a record by assigning to it: person.private = True
#   - begin_changes()/end_changes(): naming the group of changes, which is
#     what the tree's history shows for it
#   - finding records cheaply with filter() first, then fetching whole
#     records (get_raw_object()) only for the ones that will change --
#     filter() results only hold some fields, so they can't be changed
# =============================================================================

# 1. Public people with no citations of their own -- the server does this
#    part. Only their event references come back, not whole records.
bar = st.progress(0, text="Finding public people with no citations of their own...")
candidates = filter(
    "person",
    where=and_filters(get_filter("person"), "private == False", "not any(c for c in citations)"),
    what=["event_ref_list"],
    order=[{"column": "surname", "direction": "asc"}],
    limit=None,
)

# 2. Every event that does have a citation, as a set of handles.
bar.progress(0, text="Finding events that have citations...")
cited_events = {event["handle"] for event in filter("event", where="any(c for c in citations)", limit=None)}

# 3. Keep the people none of whose events (or event references) is cited.
unsourced = [
    person["handle"]
    for person in candidates
    if not any(ref["citation_list"] or ref["ref"] in cited_events for ref in person["event_ref_list"] or [])
]

# 4. Mark them private -- one group of changes, saved together.
if unsourced:
    begin_changes("Mark unsourced people private")
    for i, handle in enumerate(unsourced):
        bar.progress((i + 1) / len(unsourced), text="Marking them private...")
        person = get_raw_object("person", handle)
        person.private = True
    end_changes()
    st.info(f"{len(unsourced)} public people have no sources at all -- see the list below.")
else:
    st.success("No public person is without a source.")
bar.empty()
