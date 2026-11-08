#
# Like People Search, this is a tree-wide search, not reactive to the
# selected person, so "listensToSelection" isn't needed -- but it does
# listen to the *filter* (see and_filters() below and the manifest's
# listensToFilter), so narrowing the People view first also narrows this
# search. Nothing runs until both fields below are filled in, so it won't
# fire against a placeholder value.

birth_place = st.text_input("Birth place", value="")
burial_column_label = st.text_input("Burial column label", value="")

if birth_place and burial_column_label:
    # where= can filter on birth place directly -- "birth.place.title" crosses
    # person -> birth event -> place in one hop.
    #
    # Never paste user-typed text straight into a "where" string with an
    # f-string -- see People Search's own comment on repr().
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
    # a ref_index for birth/death (person.birth_ref_index/death_ref_index).
    # So: every Burial event among everyone's event references in one
    # request (the server picks out the burials), then every burial place
    # in one more, and each person's first Burial event is looked up below.
    # "handle in [...]" needs at least one handle, hence the "if"s.
    event_handles = [ref.ref for person in chicago_born for ref in person.event_ref_list]
    burials = (
        {e.handle: e for e in events(f"handle in {event_handles!r} and type.value == EventType.BURIAL", limit=None)}
        if event_handles
        else {}
    )
    place_handles = [e.place for e in burials.values() if e.place]
    place_of = {p.handle: p for p in places(f"handle in {place_handles!r}", limit=None)} if place_handles else {}

    set_column_titles("Person", burial_column_label)
    for person in chicago_born:
        burial = next((burials[ref.ref] for ref in person.event_ref_list if ref.ref in burials), None)
        row(person, place_of.get(burial.place) if burial else None)
else:
    st.write("Enter both a birth place and a burial column label to run the search.")
