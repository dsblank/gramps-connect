# To use this, in the Gramplet Editor:
# 1. Enter a title, like "Attributes"
# 2. Select View: Person
# 3. Turn on Re-run automatically
# 4. Place the following as Code:

if selected is None:
    print("<i>A person is not selected</i>")
else:
    person = selected
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Attributes for {full_name}</h3>")
    if person.attribute_list:
        columns("Type", "Value")
        for attr in person.attribute_list:
            row(str(attr.type), attr.value)
    else:
        html("<i>No attributes exist for this person</i>")
