#
# The "type it yourself" companion to person-filter.py/interactive-search.py
# in this same folder: those build a where= clause out of a handful of
# named widgets (given name, surname, gender, ...). This one hands you the
# raw GOQL text box instead -- the exact same syntax as the People view's
# own search box (click its (i) button for the full field/relationship
# reference for this record type) -- plus a second box naming exactly
# which field expressions come back as columns. Together that's
# filter()'s where=/what= arguments, typed straight in.
#
# Demonstrates:
#   - filter() (not people()): what= is a column list, which only filter()
#     exposes -- people() always returns every field of a full object
#   - a GOQL field expression as a *column*, not just a where= condition --
#     "birth.date" or "primary_name.surname_list[0].surname" is exactly as
#     valid in the columns box below as it is in the where box
#   - a filter()-returned row is a DataDict keyed by that same expression
#     string (see 05_pygal_charts.py's own r.surname), so a dotted key
#     needs square brackets, not dot access: row["birth.date"], not
#     row.birth.date -- the key really is the literal string "birth.date"

where_text = st.text_input("Where (GOQL)", value="")
columns_text = st.text_input(
    "Columns (comma-separated GOQL field expressions)",
    value="gramps_id, primary_name.first_name, primary_name.surname_list[0].surname",
)

columns = [c.strip() for c in columns_text.split(",") if c.strip()]

if not columns:
    st.write("Enter at least one column above to run the query.")
else:
    # and_filters(get_filter(), ...) layers this on top of whatever filter
    # is currently applied on the People view this Gramplet is a tab of --
    # same as person-filter.py/interactive-search.py (see the manifest's
    # listensToFilter) -- and tolerates an empty where box (None, same as
    # leaving where= out entirely).
    where = and_filters(get_filter(), where_text or None)

    # No sort widget here, deliberately: order= only accepts a flat,
    # top-level column name server-side (gramps-web-api rejects a
    # relationship-crossing or list-indexed path like "birth.date" or
    # "primary_name.first_name" in order_by, even though those same paths
    # are fine in where=/what=) -- and the columns above are exactly that
    # kind of arbitrary expression, so there's no column here that could
    # safely be offered as a sort key without silently failing for most
    # of what someone would actually type.
    matches = filter("person", where=where, what=columns, limit=50)

    st.write(f"{len(matches)} match(es)")
    set_column_titles(*columns)
    for match in matches:
        row(*[match[c] for c in columns])
