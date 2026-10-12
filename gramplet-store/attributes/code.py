person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    html(f"<h3>Attributes for {name_of(person)}</h3>")
    if person.attribute_list:
        set_column_titles("Type", "Value")
        for attr in person.attribute_list:
            row(str(attr.type), attr.value)
    else:
        html("<i>No attributes exist for this person</i>")
