person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    html(f"<h3>Citations for {name_of(person)}</h3>")
    if person.citation_list:
        # Confidence is stored as a plain int (Citation.CONF_*), not a
        # GrampsType, so there is no str(citation.confidence) to reach for
        # -- this mirrors gramps.gen.utils.string.conf_strings by hand,
        # the same inline-dict approach person-lookup uses for
        # Person.gender.
        from gramps.gen.lib import Citation

        confidence_label = {
            Citation.CONF_VERY_HIGH: "Very High",
            Citation.CONF_HIGH: "High",
            Citation.CONF_NORMAL: "Normal",
            Citation.CONF_LOW: "Low",
            Citation.CONF_VERY_LOW: "Very Low",
        }

        # Every citation, then every source they cite: one request each,
        # not one per record. "handle in [...]" needs at least one handle,
        # hence the "if".
        by_handle = {c.handle: c for c in citations(f"handle in {person.citation_list!r}", limit=None)}
        cited = [by_handle[h] for h in person.citation_list if h in by_handle]
        source_handles = [c.source_handle for c in cited if c.source_handle]
        source_of = {s.handle: s for s in sources(f"handle in {source_handles!r}", limit=None)} if source_handles else {}

        set_column_titles("Source", "Page", "Confidence", "Date")
        for citation in cited:
            row(
                source_of.get(citation.source_handle, "Unknown"),
                citation.page,
                confidence_label.get(citation.confidence, "Unknown"),
                citation.date,
            )
    else:
        html("<i>No citations exist for this person</i>")
