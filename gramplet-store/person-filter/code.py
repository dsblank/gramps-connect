#
# Unlike the other plugins in this folder, this one does not react to the
# selected person -- it is a tree-wide search, driven by its own widgets
# (like Gramps Desktop's sidebar Person Filter), so "Re-run automatically
# when the selected record changes" is not needed.

given_name = st.text_input("Given name contains", value="")
surname = st.text_input("Surname contains", value="")
gender_choice = st.selectbox("Gender", ["Any", "Male", "Female"], index=0)
no_death_date = st.checkbox("No death date recorded", value=False)
sort_field = st.selectbox("Sort by", ["Surname", "Given name", "Gramps ID"], index=0)

# Never paste user-typed text straight into a "where" string with an
# f-string -- see 04_interactive_search.py's own comment on repr().
given_name_pattern = f"%{given_name}%"
surname_pattern = f"%{surname}%"

gender_clause = None
if gender_choice == "Male":
    gender_clause = "gender == Person.MALE"
elif gender_choice == "Female":
    gender_clause = "gender == Person.FEMALE"

where = and_filters(
    f"like(given_name, {given_name_pattern!r})" if given_name else None,
    f"like(surname, {surname_pattern!r})" if surname else None,
    gender_clause,
    "death.date.sortval is None" if no_death_date else None,
)

order_column = {"Surname": "surname", "Given name": "given_name", "Gramps ID": "gramps_id"}[sort_field]

# Limit kept modest, same as 04_interactive_search.py, since this reruns
# on every keystroke.
matches = people(where, order=[{"column": order_column, "direction": "asc"}], limit=50)

st.write(f"{len(matches)} match(es)")
columns("Person")
for person in matches:
    row(person)
