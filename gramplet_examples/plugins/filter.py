# To use this, in the Gramplet Editor:
# 1. Enter a title, like "Filter"
# 2. Select View: Person
# 3. Place the following as Code:
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
conditions = []
if given_name:
    pattern = f"%{given_name}%"
    conditions.append(f"like(given_name, {pattern!r})")
if surname:
    pattern = f"%{surname}%"
    conditions.append(f"like(surname, {pattern!r})")
if gender_choice == "Male":
    conditions.append("gender == Person.MALE")
elif gender_choice == "Female":
    conditions.append("gender == Person.FEMALE")
if no_death_date:
    conditions.append("death.date.sortval is None")
where = " and ".join(conditions) if conditions else None

order_column = {"Surname": "surname", "Given name": "given_name", "Gramps ID": "gramps_id"}[sort_field]

# Limit kept modest, same as 04_interactive_search.py, since this reruns
# on every keystroke.
matches = people(where, order=[{"column": order_column, "direction": "asc"}], limit=50)

st.write(f"{len(matches)} match(es)")
columns("Person")
for person in matches:
    row(person)
