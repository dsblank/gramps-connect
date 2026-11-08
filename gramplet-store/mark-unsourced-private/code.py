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
#   - one where= clause that finds exactly the records to change, and
#     people() handing them back whole -- ready to change -- in one request
#     (filter() results only hold some fields, so they can't be changed)
# =============================================================================

# The same test as People Without Sources -- any(events, ...) follows each
# event reference to its event, any(event_ref_list, ...) looks inside each
# reference itself -- plus "still public". The server does all of it.
NO_SOURCES = (
    "not any(citations)"
    " and not any(event_ref_list, any(citation_list))"
    " and not any(events, any(citations))"
)
bar = st.progress(0, text="Finding public people with no sources...")
unsourced = people(
    and_filters(get_filter("person"), "private == False", NO_SOURCES),
    order=[{"column": "surname", "direction": "asc"}],
    limit=None,
)

# Mark them private -- one group of changes, saved together.
if unsourced:
    begin_changes("Mark unsourced people private")
    for person in unsourced:
        person.private = True
    end_changes()
    st.info(f"{len(unsourced)} public people have no sources at all -- see the list below.")
else:
    st.success("No public person is without a source.")
bar.empty()
