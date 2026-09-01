# =============================================================================
# Age-at-Death Histogram
# =============================================================================
# Age-at-death distribution, as a plotly histogram. plotly is pre-bundled
# the same way pygal/matplotlib are -- a plain
# `from plotly.subplots import make_subplots` works offline, no
# %pip install needed, and (unlike `import plotly.graph_objects as go` +
# go.Histogram(...)) never needs the graph_objects import at all:
# make_subplots() returns a real Figure, and Figure.add_histogram(...)
# builds the trace for you.
#
# Demonstrates:
#   - print(fig) -- a plain print() of a plotly Figure is recognized
#     automatically and rendered as an interactive chart (hover tooltips,
#     zoom/pan); you never need to call to_html()/embed it by hand
#   - computing something (age at death) that isn't a field Gramps stores
#     directly, from two dates that are
# =============================================================================

from plotly.subplots import make_subplots

# birth.date.sortval/death.date.sortval cross one relationship each (see
# GrampletHelpDialog's "where" section) -- sortval is the date's position
# on the calendar as a plain number of days, which is what makes "person
# has both a birth and a death date" expressible as a where clause at all.
#
# filter() rather than people(): with limit=5000, people() would mean
# 5000 full-object network fetches for a histogram that only needs two
# dates -- see 05_pygal_charts.py's own comment on this same trade-off.
# There's no db method that reaches a related field like birth.date back
# into the result at all (see 07_relationship_queries.py), so filter()
# is the only way to get this cheaply, not a shortcut around db.
#
# and_filters(get_filter(), ...) layers this Gramplet's own "has both
# dates" requirement on top of whatever filter is currently applied on
# the People view it's a tab of (FilterBar's search box) -- so filtering
# the list down to one family branch narrows the histogram the same way,
# instead of it always covering the whole tree regardless. Requires
# `views: ["person"]` in the manifest (get_filter() only hands back a
# where_expr matching the view's own object type) and
# `listensToFilter: true` so the chart actually re-renders when the
# filter changes, not just on the next unrelated re-run.
rows = filter(
    "person",
    where=and_filters(
        get_filter(),
        "birth.date.sortval is not None and death.date.sortval is not None",
    ),
    what=["birth.date", "death.date"],
    limit=5000,
)

# sortval is a day count (not a year), so this is ordinary arithmetic, not
# anything Gramps-specific: a year is close enough to 365.25 days for a
# histogram bucket. Skip anything that comes out negative or absurd (a
# handful of badly entered dates in most real trees) rather than letting
# one bad row wreck the chart's x-axis.
ages = []
for r in rows:
    # r["birth.date"] -- square brackets, not r.birth.date -- because the
    # key really is the literal string "birth.date" (that's how filter()
    # names a field reached by crossing a relationship; see the "where"
    # section of the (i) help button), not a nested "birth" dict you could
    # dot into. It's a plain dict itself (Gramps's Date struct), so one
    # more square-bracket lookup reaches sortval.
    birth_sortval = r["birth.date"]["sortval"]
    death_sortval = r["death.date"]["sortval"]
    age_years = (death_sortval - birth_sortval) / 365.25
    if 0 <= age_years <= 110:
        ages.append(age_years)

fig = make_subplots()
fig.add_histogram(x=ages, nbinsx=20)
fig.update_layout(
    title=f"Age at death ({len(ages)} people with both dates recorded)",
    xaxis_title="Age at death (years)",
    yaxis_title="Number of people",
)

# That's it -- no to_html()/embedding to write by hand. A bare print(fig)
# is enough.
print(fig)
