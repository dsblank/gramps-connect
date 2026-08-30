# To use this, in the Gramps Connect Gramplet Editor:
# 1. Enter a title, like "Born in..."
# 2. Select View: Person
# 3. Place the following as Code:
#
# Like plugins/filter.py, this is a tree-wide search, not reactive to the
# selected person, so "Re-run automatically" isn't needed.

from gramps.gen.lib import EventType

birth_place = st.text_input("Birth place", value="Chicago, Cook, Illinois, USA")
burial_column_label = st.text_input("Burial column label", value="Burial place")

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

# There's no equivalent shortcut for burial, though -- Gramps only keeps a
# ref_index for birth/death (person.birth_ref_index/death_ref_index), so a
# where= condition can only ask "does a Burial event exist" (true/false),
# never hand back *where*. Getting the actual place means walking
# event_ref_list by hand, stopping at the first Burial event found.

columns("Person", burial_column_label)
for person in chicago_born:
    burial_place = None
    for event_ref in person.event_ref_list:
        event = db.get_event_from_handle(event_ref.ref)
        if event.type == EventType.BURIAL:
            burial_place = db.get_place_from_handle(event.place) if event.place else None
            break
    row(person, burial_place)
