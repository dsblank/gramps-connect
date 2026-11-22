# =============================================================================
# Attribute Usage
# =============================================================================
# Every attribute type in use in the tree, with how many records have it.
# Click one to see, beside the list, every person, family, event, media,
# source and citation that has it, with its value. Attributes on event and
# media references (an event's attributes for one participant, a photo's
# for one person) aren't included.
#
# Demonstrates:
#   - st.columns(): the list on the left, the picked attribute's records
#     on the right, each drawn inside its own 'with' block
#   - a clickable html() table: a row carrying data-gramplet-key and
#     data-gramplet-event="click" reruns this code with that key set to
#     True in st.session_state (the same attributes st.button() uses)
#   - attribute_list['Type'] in a where= clause and as a what= column: the
#     first attribute of that type, built-in (Nickname) or your own
#     (Hair color)
#   - {t!r} to put a name into a query as a quoted string, so a name with
#     quotes in it can't break the query
#   - st.session_state to keep a slow first step, so a click doesn't
#     repeat it
#   - limit= plus one extra row, to tell whether there were more matches
#     without counting them all
#   - a row() cell that links to its record: any dict with a "_class" and
#     a "handle" (filter() always returns "handle")
# =============================================================================

import html as _html

KINDS = ["person", "family", "event", "media", "source", "citation"]
SCAN_LIMIT = 5000   # records with attributes read per kind, to find type names
SHOW_LIMIT = 200    # rows shown per kind for the chosen type

# The attribute types in use, with how many records have each. Each kind
# is one whole-table scan on the server, so the result is kept for the
# rest of this window's session.
if "used" not in st.session_state:
    used, counts, partial = {}, {}, []
    bar = st.progress(0, text="Finding attribute types...")
    for i, kind in enumerate(KINDS):
        bar.progress(i / len(KINDS), text=f"Finding attribute types in {kind} records...")
        rs = filter(kind, where="any(a for a in attribute_list)",
                    what=["attribute_list"], limit=SCAN_LIMIT + 1)
        if len(rs) > SCAN_LIMIT:
            partial.append(kind)
            rs = rs[:SCAN_LIMIT]
        for r in rs:
            # A record with two attributes of one type counts once.
            for name in {str(a.type) for a in r.attribute_list}:
                used.setdefault(name, set()).add(kind)
                counts[name] = counts.get(name, 0) + 1
    bar.empty()
    st.session_state["used"] = used
    st.session_state["counts"] = counts
    st.session_state["partial"] = partial
used = st.session_state["used"]
counts = st.session_state["counts"]
partial = st.session_state["partial"]
names = sorted(used)

# A click on a row of the left table arrives as session_state["pick:<n>"]
# = True, set just before this run. Turn it into the selection and clear
# it, so it doesn't count again on the next run.
for k in [k for k in st.session_state if k.startswith("pick:")]:
    st.session_state["selected"] = names[int(k[5:])]
    del st.session_state[k]
t = st.session_state.get("selected")
if t not in used:
    t = None

if partial:
    st.warning(f"Only the first {SCAN_LIMIT} records with attributes were checked for: "
               + ", ".join(partial) + ". Some attribute types and counts may be missing.")

if not used:
    st.info("No records have attributes.")
else:
    left, right = st.columns([1, 2])

    with left:
        # Every attribute type, with a count; click a row to show its
        # records on the right. The picked row is highlighted.
        rows_html = "".join(
            f'<tr data-gramplet-key="pick:{i}" data-gramplet-event="click" style="cursor: pointer'
            + ('; background: var(--mantine-color-default-hover); font-weight: 600' if name == t else "")
            + '">'
            f'<td style="padding: 2px 2em 2px 4px; color: var(--mantine-color-anchor)">{_html.escape(name)}</td>'
            f'<td style="padding: 2px 4px; text-align: right">{counts[name]}</td></tr>'
            for i, name in enumerate(names)
        )
        html('<table style="border-collapse: collapse">'
             '<tr><th style="text-align: left; padding: 2px 2em 2px 4px">Attribute</th>'
             '<th style="text-align: right; padding: 2px 4px">Count</th></tr>'
             f"{rows_html}</table>")

    with right:
        if t is None:
            st.info("Pick an attribute on the left to see the records that have it.")
        else:
            # The records with the chosen type, only in the kinds the scan
            # above found it in.
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
