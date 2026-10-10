# =============================================================================
# People Without Sources
# =============================================================================
# Everyone with no source at all: no citation on the person themselves,
# none on any of their event references, and none on any of their events.
# A whole-tree scan, so it runs in its own window from the Gramplets menu
# and shows its progress as it goes.
#
# Demonstrates:
#   - a Gramplet that runs as soon as its window opens (no input needed)
#   - st.progress(): one bar, moved and relabelled through each stage,
#     then removed with .empty() once the result is ready
#   - filter(..., limit=None) for every match, fetching only the fields
#     needed, rather than people() fetching every whole record
#   - get_filter("person"): the open list's filter, but only if that list
#     is People -- None otherwise, so it's always safe in a person query
#   - letting the server do what a where= clause can, and joining the rest
#     in Python (a where= clause can't look inside each event's citations)
# =============================================================================

# Show at most this many people as clickable rows; each one is its own
# fetch. The count printed above the table always covers everyone.
SHOW_AT_MOST = 200

# 1. People with no citations of their own -- the server does this part.
#    Only their event references come back, not whole records.
bar = st.progress(0, text="Finding people with no citations of their own...")
candidates = filter(
    "person",
    where=and_filters(get_filter("person"), "not any(c for c in citations)"),
    what=["event_ref_list"],
    order=[{"column": "surname", "direction": "asc"}],
    limit=None,
)

# 2. Every event that does have a citation (usually far fewer than all
#    events), as a set of handles to check against.
bar.progress(0, text="Finding events that have citations...")
cited_events = {event["handle"] for event in filter("event", where="any(c for c in citations)", limit=None)}

# 3. Keep the people none of whose events (or event references) is cited.
unsourced = []
for i, person in enumerate(candidates):
    bar.progress((i + 1) / len(candidates), text="Checking their events...")
    refs = person["event_ref_list"] or []
    if any(ref["citation_list"] or ref["ref"] in cited_events for ref in refs):
        continue
    unsourced.append(person["handle"])

total = db.get_number_of("person", where=get_filter("person"))
if unsourced:
    st.info(f"{len(unsourced)} of {total} people have no sources.")
else:
    st.success(f"All {total} people have at least one source.")

shown = unsourced[:SHOW_AT_MOST]
if shown:
    set_column_titles("Person", "Events")
    for i, handle in enumerate(shown):
        bar.progress((i + 1) / len(shown), text="Loading names...")
        person = db.get_person_from_handle(handle)
        row(person, len(person.event_ref_list))
if len(unsourced) > SHOW_AT_MOST:
    print(f"Showing the first {SHOW_AT_MOST}, by surname.")
bar.empty()
