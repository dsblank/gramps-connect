# =============================================================================
# Possible Duplicate People
# =============================================================================
# Pairs of people who might be the same person entered twice: the same
# surname and first given name (ignoring accents, case and extra spaces),
# not recorded as different genders, and born within a few years of each
# other. Select two and choose Merge to combine a real duplicate.
#
# Demonstrates:
#   - asking for input first with st.* widgets (st.number_input,
#     st.checkbox), and doing the real work
#     only behind st.button -- the pattern for a Gramplet that runs in its
#     own window but needs settings before it starts
#   - st.progress() through several stages of a longer run
#   - filter(..., what=[...], limit=None): just the fields needed, for
#     everyone, in a few large pages
# =============================================================================

import unicodedata

# The fields this compares on -- fetched for everyone in one pass.
NAME = "primary_name.first_name"
SURNAME = "primary_name.surname_list[0].surname"
BIRTH = "birth.date"
# At most this many pairs are shown as clickable rows (two fetches each).
SHOW_AT_MOST = 100

years_apart = st.number_input("Born at most this many years apart", min_value=0, max_value=50, value=2)
include_undated = st.checkbox("Also pair people with no recorded birth year", False)


def normalize(text):
    """'  Müller ' and 'muller' compare equal."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.casefold().split())


def birth_year(date):
    # A Date's dateval is [day, month, year, slash]; sortval 0 (or no
    # birth event at all) means no usable date.
    if not date or not date["sortval"]:
        return None
    return date["dateval"][2] or None


def could_match(a, b):
    # Gender 0 is female, 1 male, 2 unknown -- only a known mismatch rules
    # a pair out.
    if a["gender"] in (0, 1) and b["gender"] in (0, 1) and a["gender"] != b["gender"]:
        return False
    ya, yb = birth_year(a[BIRTH]), birth_year(b[BIRTH])
    if ya is None or yb is None:
        return include_undated
    return abs(ya - yb) <= years_apart


if st.button("Find possible duplicates"):
    bar = st.progress(0, text="Loading everyone's names and birth dates...")
    everyone = filter(
        "person",
        where=get_filter("person"),
        what=[NAME, SURNAME, BIRTH, "gender"],
        limit=None,
    )

    # Group by normalized surname + first given name; only people within
    # the same group are ever compared, which keeps this fast.
    groups = {}
    for i, person in enumerate(everyone):
        bar.progress((i + 1) / len(everyone), text="Grouping by name...")
        surname = normalize(person[SURNAME])
        given = normalize(person[NAME]).split(" ")[0]
        if surname and given:
            groups.setdefault((surname, given), []).append(person)

    pairs = []
    candidates = [group for group in groups.values() if len(group) > 1]
    for i, group in enumerate(candidates):
        bar.progress((i + 1) / len(candidates), text="Comparing...")
        for a_index, a in enumerate(group):
            for b in group[a_index + 1:]:
                if could_match(a, b):
                    pairs.append((a, b))

    if pairs:
        st.info(
            f"{len(pairs)} possible duplicate pair(s) among {len(everyone)} people. "
            "To combine a real duplicate, select both in the People list and choose Merge."
        )
    else:
        st.success(f"No possible duplicates among {len(everyone)} people.")
    shown = pairs[:SHOW_AT_MOST]
    if shown:
        set_column_titles("Person", "Possible duplicate", "Birth years")
        for i, (a, b) in enumerate(shown):
            bar.progress((i + 1) / len(shown), text="Loading names...")
            years = " / ".join(str(birth_year(p[BIRTH]) or "?") for p in (a, b))
            row(db.get_person_from_handle(a["handle"]), db.get_person_from_handle(b["handle"]), years)
    if len(pairs) > SHOW_AT_MOST:
        print(f"Showing the first {SHOW_AT_MOST}.")
    bar.empty()
