# =============================================================================
# 05 - Charts with pygal
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
# filter() rather than people() here: people() with limit=5000 would mean
# 5000 separate network fetches, one full object per match (see
# 04_interactive_search.py's own comment on this) -- much too slow for a
# chart that only needs one field. filter()'s own 'what' list keeps this
# to a small, fixed number of requests regardless: only surname crosses
# the network, not every field on every person, and 5000 (comfortably
# above the 1000-per-request server cap) is paged through transparently.
# There's no db method that can do this -- reaching past db here isn't
# a shortcut, it's the only way to stay this cheap at this scale.
rows = filter("person", what=["surname"], limit=5000)
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
# count(..., where=...) -- no db equivalent for a conditional count, same
# reasoning as 03_tree_statistics.py's own use of it.
women = count("person", where="gender == Person.FEMALE")
men = count("person", where="gender == Person.MALE")
other = db.get_number_of_people() - women - men

pie = pygal.Pie(title="Gender")
pie.add("Female", women)
pie.add("Male", men)
if other:
    pie.add("Unknown / other", other)
html(pie.render())
