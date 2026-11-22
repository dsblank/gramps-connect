# =============================================================================
# Attribute Usage
# =============================================================================
# Every attribute type in use in the tree, and for the one you pick, every
# person, family, event, media, source and citation that has it, with its
# value. Attributes on event and media references (an event's attributes
# for one participant, a photo's for one person) aren't included.
#
# Demonstrates:
#   - attribute_list['Type'] in a where= clause and as a what= column: the
#     first attribute of that type, built-in (Nickname) or your own
#     (Hair color)
#   - {t!r} to put a name into a query as a quoted string, so a name with
#     quotes in it can't break the query
#   - st.session_state to keep a slow first step, so picking another type
#     in the st.selectbox doesn't repeat it
#   - limit= plus one extra row, to tell whether there were more matches
#     without counting them all
#   - a row() cell that links to its record: any dict with a "_class" and
#     a "handle" (filter() always returns "handle")
# =============================================================================

KINDS = ["person", "family", "event", "media", "source", "citation"]
SCAN_LIMIT = 5000   # records with attributes read per kind, to find type names
SHOW_LIMIT = 200    # rows shown per kind for the chosen type

# Step 1: the attribute types in use. Each kind is one whole-table scan on
# the server, so the result is kept for the rest of this window's session.
if "used" not in st.session_state:
    used, partial = {}, []
    bar = st.progress(0, text="Finding attribute types...")
    for i, kind in enumerate(KINDS):
        bar.progress(i / len(KINDS), text=f"Finding attribute types in {kind} records...")
        rs = filter(kind, where="any(a for a in attribute_list)",
                    what=["attribute_list"], limit=SCAN_LIMIT + 1)
        if len(rs) > SCAN_LIMIT:
            partial.append(kind)
            rs = rs[:SCAN_LIMIT]
        for r in rs:
            for a in r.attribute_list:
                used.setdefault(str(a.type), set()).add(kind)
    bar.empty()
    st.session_state["used"] = used
    st.session_state["partial"] = partial
used = st.session_state["used"]
partial = st.session_state["partial"]

if partial:
    st.warning(f"Only the first {SCAN_LIMIT} records with attributes were checked for: "
               + ", ".join(partial) + ". Some attribute types may be missing.")

if not used:
    st.info("No records have attributes.")
else:
    # Step 2: the records with the chosen type, only in the kinds step 1
    # found it in.
    t = st.selectbox("Attribute type", sorted(used))
    key = f"attribute_list[{t!r}]"
    col = f"{key}.value"
    kinds = [k for k in KINDS if k in used[t]]
    bar = st.progress(0, text=f"Finding {t}...")
    more = []
    set_column_titles("Record", t)
    for i, kind in enumerate(kinds):
        bar.progress(i / len(kinds), text=f"Finding {t} in {kind} records...")
        rs = filter(kind, where=f"{key} != None",
                    what=["gramps_id", col], limit=SHOW_LIMIT + 1)
        if len(rs) > SHOW_LIMIT:
            more.append(kind)
        for r in rs[:SHOW_LIMIT]:
            row(dict(r, _class=kind.capitalize()), r[col])
    bar.empty()
    if more:
        st.info(f"Showing the first {SHOW_LIMIT} of each: " + ", ".join(more)
                + f". Filter that list view with {key} != None to see them all.")
