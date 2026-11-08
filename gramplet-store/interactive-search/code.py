# =============================================================================
# People Search
# =============================================================================
# A live search over People: type part of a name, pick a gender and a sort
# order, and the table updates -- no separate "run" step. This is the
# Streamlit-style `st.*` widget API: clicking/typing into a widget reruns
# just this Gramplet's own code (not the whole page), and each widget
# remembers its own current value for you across those reruns.
#
# Demonstrates:
#   - st.text_input(), st.radio(), st.selectbox(), st.checkbox(),
#     st.number_input(), st.button() -- and st.info() for an empty result
#   - safely building a "where" string from user-typed text (never use an
#     f-string to paste user input straight in -- see the comment below)
#   - st.button()'s own quirk: it returns True for exactly one rerun (the
#     one triggered by clicking it), never persisted -- unlike every
#     other widget here, there is no "current state" to read back later
#   - st.session_state, both to reset the other widgets and for a value
#     that isn't tied to any one widget
# =============================================================================

# Widgets render in the order you call them -- put st.button("Reset") near
# the top, and clear the *other* widgets' session_state entries before
# they're drawn, so the reset takes effect on the very same rerun rather
# than one render behind. Every widget's value lives in session_state
# under its key (its label, unless you pass key= yourself).
if st.button("Reset"):
    for key in ("Given name contains", "Surname contains", "Gender", "Sort by",
                "No recorded death date", "Show at most"):
        st.session_state.pop(key, None)

# st.text_input(label, value="", key=None) renders a text box and returns
# whatever is currently typed into it -- on the very first render, "value"
# (the default, empty here); after that, whatever the person last typed.
given_name = st.text_input("Given name contains", value="")
surname = st.text_input("Surname contains", value="")

# st.radio(label, options, index=0, key=None, horizontal=False) shows
# every choice at once and returns whichever is currently selected (the
# real option from your list, not just its displayed string) --
# horizontal=True puts them in a row. st.selectbox() is the same idea as a
# dropdown, for a longer list.
gender = st.radio("Gender", ["Any", "Female", "Male"], horizontal=True)
sort_field = st.selectbox("Sort by", ["Surname", "Given name", "Gramps ID"])

no_death_date = st.checkbox("No recorded death date", value=False)

# st.number_input(label, min_value=None, max_value=None, value=...) returns
# a number -- an int here, since every number given is an int.
limit = st.number_input("Show at most", min_value=1, max_value=500, value=50)

# IMPORTANT: never paste user-typed text straight into a "where" string
# with an f-string (f"surname == '{surname}'") -- someone typing a stray
# quote character would break the query, or change its meaning. repr()
# produces a correctly quoted-and-escaped Python string literal instead,
# which is exactly what GOQL's own string syntax expects.
#
# and_filters(*clauses) ANDs together whichever clauses aren't None/empty --
# no need to build up a "conditions" list and join it by hand. get_filter()
# is just another clause: whatever filter is currently applied on this
# People view, so this search respects it instead of always running over
# the whole tree -- see the manifest's listensToFilter, which re-runs this
# Gramplet when that filter changes, not just when a widget above is
# touched.
#
# A death with no date recorded has a sortval of 0, and someone with no
# death event at all has none (None) -- "no recorded death date" covers
# both.
where = and_filters(
    get_filter(),
    f"like(given_name, {f'%{given_name}%'!r})" if given_name else None,
    f"like(surname, {f'%{surname}%'!r})" if surname else None,
    {"Female": "gender == Person.FEMALE", "Male": "gender == Person.MALE"}.get(gender),
    "death.date.sortval is None or death.date.sortval == 0" if no_death_date else None,
)

order_column = {"Surname": "surname", "Given name": "given_name", "Gramps ID": "gramps_id"}[sort_field]

# people() returns whole records, in one request. 'order' is a list of
# {"column": ..., "direction": "asc"|"desc"} dicts, most significant
# column first. This reruns on every keystroke, so a modest limit keeps
# typing responsive on a big tree.
results = people(where, order=[{"column": order_column, "direction": "asc"}], limit=limit)

if results:
    st.write(f"{len(results)} match(es)")
else:
    st.info("No one matches.")

# A whole person renders as a clickable row on its own -- no need to
# build the name text by hand.
set_column_titles("Person")
for person in results:
    row(person)

# st.session_state is a dict (both state.foo and state["foo"] work) for
# remembering anything else across reruns -- here, how many times this
# Gramplet has rerun in the current tab (typing a letter, picking an
# option, and clicking Reset each count as one).
if "search_count" not in st.session_state:
    st.session_state.search_count = 0
st.session_state.search_count += 1
st.write(f"(this Gramplet has run {st.session_state.search_count} time(s) this session)")
