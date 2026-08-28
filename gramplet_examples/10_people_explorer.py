# =============================================================================
# 10 - People Explorer (capstone)
# =============================================================================
# A small but complete interactive tool: search box + gender filter +
# sort order + a "reset" button + a running search counter, all live --
# combines every widget from stBootstrap.ts's `st.*` API in one Gramplet.
# Read 04_interactive_search.py first if you haven't; this builds on the
# same pattern with one more widget type (st.button) and a slightly
# richer layout.
#
# Demonstrates:
#   - every st.* widget together: text_input, selectbox, checkbox, button
#   - st.button()'s own quirk: it returns True for exactly one rerun (the
#     one triggered by clicking it), never persisted -- unlike every
#     other widget here, there is no "current state" to read back later
#   - resetting other widgets' remembered values via st.session_state
# =============================================================================

# Widgets render in the order you call them -- put st.button("Reset") near
# the top, and clear the *other* widgets' session_state entries before
# they're drawn, so the reset takes effect on the very same rerun rather
# than one render behind.
if st.button("Reset filters"):
    for key in ("Surname contains", "Gender", "Sort by", "No recorded death date (possibly living)"):
        st.session_state.pop(key, None)

surname = st.text_input("Surname contains", value="")
gender_choice = st.selectbox("Gender", ["Any", "Female", "Male"], index=0)
sort_field = st.selectbox("Sort by", ["Surname", "Given name"], index=0)
living_only = st.checkbox("No recorded death date (possibly living)", value=False)

conditions = []
if surname:
    pattern = f"%{surname}%"
    conditions.append(f"like(surname, {pattern!r})")
if gender_choice == "Female":
    conditions.append("gender == Person.FEMALE")
elif gender_choice == "Male":
    conditions.append("gender == Person.MALE")
if living_only:
    conditions.append("death.date.sortval is None")
where = " and ".join(conditions) if conditions else None

order_column = {"Surname": "surname", "Given name": "given_name"}[sort_field]

# people() -- see 04_interactive_search.py's own comment on why this
# (and not the lower-level filter() it's built on) is the right function
# to reach for. limit stays modest (50) for the same reason: this reruns
# on every keystroke, and each match is a real network fetch.
results = people(where, order=[{"column": order_column, "direction": "asc"}], limit=50)

# st.write() is plain text (a thin alias for print()), not markdown -- no
# **bold**/*italic* rendering, unlike real Streamlit's st.write().
st.write(f"{len(results)} match(es)")

columns("Person")
for person in results:
    row(person)

# Anything not tied to a specific widget's own value still lives in
# session_state too -- here, a plain counter of how many times *this*
# Gramplet has rerun in the current tab (typing a letter, picking a
# dropdown option, and clicking Reset each count as one rerun).
if "run_count" not in st.session_state:
    st.session_state.run_count = 0
st.session_state.run_count += 1
st.write(f"(rerun {st.session_state.run_count} time(s) this session)")
