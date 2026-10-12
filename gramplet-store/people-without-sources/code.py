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
#   - st.progress(): one bar, relabelled through each stage, then removed
#     with .empty() once the result is ready
#   - one where= clause that looks through other records: any(events, ...)
#     follows each event reference to its event, and any(event_ref_list,
#     ...) looks inside each reference itself -- the server does all of it
#   - people(..., limit=...) for just the rows shown, plus count() for how
#     many match in all, rather than fetching every match
#   - get_filter("person"): the open list's filter, but only if that list
#     is People -- None otherwise, so it's always safe in a person query
# =============================================================================

# Show at most this many people as clickable rows. The count printed above
# the table always covers everyone.
SHOW_AT_MOST = 200

NO_SOURCES = (
    "not any(citations)"
    " and not any(event_ref_list, any(citation_list))"
    " and not any(events, any(citations))"
)
where = and_filters(get_filter("person"), NO_SOURCES)

bar = st.progress(0, text="Counting people with no sources...")
unsourced = count("person", where=where)
total = db.get_number_of("person", where=get_filter("person"))
if unsourced:
    st.info(f"{unsourced} of {total} people have no sources.")
    bar.progress(0.5, text="Loading names...")
    set_column_titles("Person", "Events")
    for person in people(where=where, order=[{"column": "surname", "direction": "asc"}], limit=SHOW_AT_MOST):
        row(person, len(person.event_ref_list))
else:
    st.success(f"All {total} people have at least one source.")
if unsourced > SHOW_AT_MOST:
    print(f"Showing the first {SHOW_AT_MOST}, by surname.")
bar.empty()
