#
# Like plugins/filter.py, this is a tree-wide search, not reactive to the
# selected person, so "listensToSelection" isn't needed -- but it does
# listen to the *filter* (see and_filters() below and the manifest's
# listensToFilter), so narrowing the People view first also narrows this
# search. Nothing runs until both fields below are filled in, so it won't
# fire against a placeholder value.

from gramps.gen.lib import EventType

birth_place = st.text_input("Birth place", value="")
burial_column_label = st.text_input("Burial column label", value="")

if birth_place and burial_column_label:
    # where= can filter on birth place directly -- "birth.place.title" crosses
    # person -> birth event -> place in one hop.
    #
    # Never paste user-typed text straight into a "where" string with an
    # f-string -- see filter.py's own comment on repr().
    #
    # and_filters(get_filter(), ...) layers this on top of whatever filter
    # is currently applied on the People view -- so "born in Chicago"
    # searches only the currently filtered list, not always the whole tree.

    chicago_born = people(
        and_filters(get_filter(), f"birth.place.title == {birth_place!r}"),
        order=[{"column": "surname", "direction": "asc"}],
        limit=200,
    )

    # There's no equivalent shortcut for burial, though -- Gramps only keeps
    # a ref_index for birth/death (person.birth_ref_index/death_ref_index),
    # so a where= condition can only ask "does a Burial event exist"
    # (true/false), never hand back *where*. Getting the actual place means
    # walking event_ref_list by hand, stopping at the first Burial event
    # found.

    set_column_titles("Person", burial_column_label)
    for person in chicago_born:
        burial_place = None
        for event_ref in person.event_ref_list:
            event = db.get_event_from_handle(event_ref.ref)
            if event.type == EventType.BURIAL:
                burial_place = db.get_place_from_handle(event.place) if event.place else None
                break
        row(person, burial_place)
else:
    st.write("Enter both a birth place and a burial column label to run the search.")
