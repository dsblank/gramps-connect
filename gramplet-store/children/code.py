person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    html(f"<h3>Children of {name_of(person)}</h3>")
    if not person.family_list:
        html("<i>This person is not a parent in any recorded family</i>")
    else:
        # One request per kind of record, not one per record: every family,
        # then every spouse and child, then the children's birth and death
        # dates (what= reaches through to each one's birth/death event).
        # "handle in [...]" needs at least one handle, hence the "if"s.
        by_handle = {f.handle: f for f in families(f"handle in {person.family_list!r}", limit=None)}
        my_families = [by_handle[h] for h in person.family_list if h in by_handle]
        spouse_of = {
            f.handle: f.mother_handle if f.father_handle == person.handle else f.father_handle
            for f in my_families
        }
        child_handles = [ref.ref for f in my_families for ref in f.child_ref_list]
        wanted = [h for h in list(spouse_of.values()) + child_handles if h]
        relatives = {p.handle: p for p in people(f"handle in {wanted!r}", limit=None)} if wanted else {}
        dates = {
            d.handle: d
            for d in filter("person", where=f"handle in {child_handles!r}", what=["birth.date", "death.date"], limit=None)
        } if child_handles else {}

        set_column_titles("Child", "Birth Date", "Death Date", "Spouse")
        for family in my_families:
            spouse = relatives.get(spouse_of[family.handle])
            for ref in family.child_ref_list:
                child_dates = dates.get(ref.ref, {})
                row(
                    relatives.get(ref.ref),
                    child_dates.get("birth.date"),
                    child_dates.get("death.date"),
                    spouse or "Unknown",
                )
