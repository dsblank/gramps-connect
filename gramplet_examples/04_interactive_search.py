# =============================================================================
# 04 - Interactive Search
# =============================================================================
# A live search box over People: type a surname, pick which field to sort
# by, and the table updates -- no separate "run" step. This is the
# Streamlit-style `st.*` widget API: clicking/typing into a widget reruns
# just this Gramplet's own code (not the whole page), and each widget
# remembers its own current value for you across those reruns.
#
# Demonstrates:
#   - st.text_input(), st.selectbox(), st.checkbox()
#   - safely building a "where" string from user-typed text (never use an
#     f-string to paste user input straight in -- see the comment below)
#   - st.session_state for a value that isn't tied to one specific widget
# =============================================================================

# st.text_input(label, value="", key=None) renders a text box and returns
# whatever is currently typed into it -- on the very first render, "value"
# (the default, empty here); after that, whatever the person last typed.
surname = st.text_input("Surname contains", value="")

# st.selectbox(label, options, index=0, key=None) renders a dropdown and
# returns whichever option is currently selected (the real option from
# your list, not just its displayed string).
sort_field = st.selectbox("Sort by", ["Surname", "Given name", "Gramps ID"], index=0)

only_no_death_date = st.checkbox("Only show people with no recorded death date", value=False)

# IMPORTANT: never paste user-typed text straight into a "where" string
# with an f-string (f"surname == '{surname}'") -- someone typing a stray
# quote character would break the query, or change its meaning. repr()
# produces a correctly quoted-and-escaped Python string literal instead,
# which is exactly what GOQL's own string syntax expects -- the same
# pattern db.get_person_from_gramps_id() itself uses internally.
conditions = []
if surname:
    pattern = f"%{surname}%"
    conditions.append(f"like(surname, {pattern!r})")
if only_no_death_date:
    conditions.append("death.date.sortval is None")
where = " and ".join(conditions) if conditions else None

order_column = {"Surname": "surname", "Given name": "given_name", "Gramps ID": "gramps_id"}[sort_field]

# people() -- same function as 01_hello_table.py, not the lower-level
# filter()/get_object() it's built on internally (those exist, but
# they're implementation details a Gramplet author has no reason to reach
# for directly -- everything they can do is already available through
# people()/families()/etc. and db's own methods). 'order' is a list of
# {"column": ..., "direction": "asc"|"desc"} dicts, most significant
# column first. limit is modest (50, the same default every db/people()
# method already uses) since this reruns on every keystroke -- each
# match here is a real object, one more network fetch than the search
# itself, so keeping the limit reasonable keeps typing responsive.
results = people(where, order=[{"column": order_column, "direction": "asc"}], limit=50)

st.write(f"{len(results)} match(es)")

# A whole Person object renders as a clickable row on its own (see
# 01_hello_table.py) -- no need to build the name text by hand.
columns("Person")
for person in results:
    row(person)

# st.session_state is a dict (both state.foo and state["foo"] work) for
# remembering anything else across reruns that isn't already tied to one
# of the widgets above -- e.g. how many searches have been run this
# session. Every widget's own value already lives in here too, under its
# key (the label, unless you pass key= yourself), so this is the same
# storage st.text_input()/st.selectbox() use, not a separate mechanism.
if "search_count" not in st.session_state:
    st.session_state.search_count = 0
st.session_state.search_count += 1
st.write(f"(this Gramplet has run {st.session_state.search_count} time(s) this session)")
