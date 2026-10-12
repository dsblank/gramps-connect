# =============================================================================
# Charts with pygal
# =============================================================================
# Two small charts -- top surnames as a bar chart, gender split as a pie
# chart -- using pygal, an SVG charting library that's pre-bundled and
# works fully offline (a plain `import pygal` is enough, no %pip install
# and no network round trip to PyPI).
#
# Demonstrates:
#   - html(chart.render()) -- how any SVG-producing chart library plugs in
#   - collections.Counter for a quick tally, ordinary Python otherwise
# =============================================================================

import pygal
from collections import Counter

# ---- Chart 1: top 10 surnames --------------------------------------------
# filter() with what= rather than whole records: people() would download
# every field of every person, for a chart that only needs one. With
# what=["surname"] only surnames cross the network, and limit=None
# (everyone) is paged through 1000 at a time behind the scenes.
#
# where=get_filter() layers this on top of whatever filter is currently
# applied on whichever People-typed view this Gramplet is a tab of (see
# the manifest's views/listensToFilter) -- so both charts below cover the
# filtered list, not always the whole tree.
rows = filter("person", where=get_filter(), what=["surname"], limit=None)
surname_counts = Counter(r.surname for r in rows if r.surname)
top_surnames = surname_counts.most_common(10)

bar = pygal.Bar(title="Top 10 surnames", x_label_rotation=30, show_legend=False)
bar.x_labels = [name for name, _ in top_surnames]
bar.add("People", [n for _, n in top_surnames])
# pygal's render() defaults to bytes, not str -- html() decodes that for
# you automatically either way, so `.render()` alone (no is_unicode=True
# needed) is fine here.
html(bar.render())

# ---- Chart 2: gender split --------------------------------------------
# db.get_number_of(..., where=...) -- the conditional counterpart to
# db.get_number_of_people(), same reasoning as Tree Statistics' own
# use of it. and_filters(get_filter(), ...) narrows each count to the
# current filter, same as Chart 1 above -- and the "total" used for the
# "other" slice is counted the same filtered way (rather than
# db.get_number_of_people(), which is always the whole tree), so the three
# slices still add up correctly whether or not a filter is applied.
total = db.get_number_of("person", where=get_filter())
women = db.get_number_of("person", where=and_filters(get_filter(), "gender == Person.FEMALE"))
men = db.get_number_of("person", where=and_filters(get_filter(), "gender == Person.MALE"))
other = total - women - men

pie = pygal.Pie(title="Gender")
pie.add("Female", women)
pie.add("Male", men)
if other:
    pie.add("Unknown / other", other)
html(pie.render())
