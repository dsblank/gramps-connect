# To use this, in the Gramps Connect Gramplet Editor:
# 1. Enter a Name -- this is the tab label -- like "Born in..."
# 2. Enter a Description, like "Find everyone born in a given place, with a burial column you name yourself"
# 3. Select View: Person
# 4. Place the following as Code:
#
# Like plugins/filter.py, this is a tree-wide search, not reactive to the
# selected person, so "Re-run automatically" isn't needed. Nothing runs
# until both fields below are filled in, so it won't fire against a
# placeholder value.

from gramps.gen.lib import EventType

birth_place = st.text_input("Birth place", value="")
burial_column_label = st.text_input("Burial column label", value="")

if birth_place and burial_column_label:
    # where= can filter on birth place directly -- "birth.place.title" crosses
    # person -> birth event -> place in one hop.
    #
    # Never paste user-typed text straight into a "where" string with an
    # f-string -- see filter.py's own comment on repr().

    chicago_born = people(
        f"birth.place.title == {birth_place!r}",
        order=[{"column": "surname", "direction": "asc"}],
        limit=200,
    )

    # There's no equivalent shortcut for burial, though -- Gramps only keeps
    # a ref_index for birth/death (person.birth_ref_index/death_ref_index),
    # so a where= condition can only ask "does a Burial event exist"
    # (true/false), never hand back *where*. Getting the actual place means
    # walking event_ref_list by hand, stopping at the first Burial event
    # found.

    columns("Person", burial_column_label)
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
