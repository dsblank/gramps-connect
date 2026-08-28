# To use this, in the Gramplet Editor:
# 1. Enter a title, like "Citations"
# 2. Select View: Person
# 3. Turn on Re-run automatically
# 4. Place the following as Code:

if selected is None:
    html("<i>A person is not selected</i>")
else:
    person = selected
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()
    html(f"<h3>Citations for {full_name}</h3>")
    if person.citation_list:
        # Confidence is stored as a plain int (Citation.CONF_*), not a
        # GrampsType, so there is no str(citation.confidence) to reach for
        # -- this mirrors gramps.gen.utils.string.conf_strings by hand,
        # the same inline-dict approach 02_person_lookup.py uses for
        # Person.gender.
        from gramps.gen.lib import Citation

        confidence_label = {
            Citation.CONF_VERY_HIGH: "Very High",
            Citation.CONF_HIGH: "High",
            Citation.CONF_NORMAL: "Normal",
            Citation.CONF_LOW: "Low",
            Citation.CONF_VERY_LOW: "Very Low",
        }

        columns("Source", "Page", "Confidence", "Date")
        for citation_handle in person.citation_list:
            citation = db.get_citation_from_handle(citation_handle)
            source = (
                db.get_source_from_handle(citation.source_handle) if citation.source_handle else None
            )
            row(
                source if source else "Unknown",
                citation.page,
                confidence_label.get(citation.confidence, "Unknown"),
                citation.date,
            )
    else:
        html("<i>No citations exist for this person</i>")
