# =============================================================================
# 12 - Charts with plotly
# =============================================================================
# The same two charts as 05_pygal_charts.py -- top surnames, gender split --
# using plotly instead. print(fig) recognizes any real
# plotly.graph_objects.Figure instance and renders it as an interactive
# chart (hover tooltips, zoom/pan) the same way it recognizes a matplotlib
# figure -- but unlike matplotlib, a Figure is built here via
# plotly.subplots.make_subplots() + Figure.add_bar()/add_pie() rather than
# `import plotly.graph_objects as go` + go.Bar(...)/go.Pie(...): both
# produce the exact same object (make_subplots() returns a real
# graph_objects.Figure under the hood), but this way never needs the
# `graph_objects` import at all, and stays in the same lightweight
# narwhals+packaging footprint (no numpy) doing it. Stick to this rather
# than plotly.express: express needs numpy just to import, and pandas too
# once it's building a chart from plain lists rather than a dataframe --
# neither is pre-bundled, so express fails with a ModuleNotFoundError
# unless the Gramplet's own code also does `import numpy`/`import pandas`
# itself (which pulls them in the same way any other import here does).
#
# print() deliberately does NOT recognize a plain
# {"data": [...], "layout": {...}} dict the way it recognizes a Figure --
# tempting (zero plotly import needed at all), but too easy to trip by
# accident on an ordinary dict a Gramplet wants printed as data, not
# rendered as a chart; a real Figure object is unambiguous.
#
# Demonstrates:
#   - print(fig) -- recognized automatically and rendered as an
#     interactive chart, the same way print(fig) works for a matplotlib
#     figure
#   - collections.Counter for a quick tally, ordinary Python otherwise
# =============================================================================

from plotly.subplots import make_subplots
from collections import Counter

# ---- Chart 1: top 10 surnames ------------------------------------------
# filter() rather than people() here: people() with limit=5000 would mean
# 5000 separate network fetches, one full object per match (see
# 04_interactive_search.py's own comment on this) -- much too slow for a
# chart that only needs one field.
rows = filter("person", what=["surname"], limit=5000)
surname_counts = Counter(r.surname for r in rows if r.surname)
top_surnames = surname_counts.most_common(10)

fig = make_subplots()
fig.add_bar(x=[name for name, _ in top_surnames], y=[n for _, n in top_surnames])
fig.update_layout(title="Top 10 surnames")
print(fig)

# ---- Chart 2: gender split -----------------------------------------------
# count(..., where=...) -- no db equivalent for a conditional count, same
# reasoning as 03_tree_statistics.py's own use of it.
women = count("person", where="gender == Person.FEMALE")
men = count("person", where="gender == Person.MALE")
other = db.get_number_of_people() - women - men

labels = ["Female", "Male"]
values = [women, men]
if other:
    labels.append("Unknown / other")
    values.append(other)

fig = make_subplots()
fig.add_pie(labels=labels, values=values)
fig.update_layout(title="Gender")

# That's it -- no to_html()/embedding to write by hand. A bare print(fig)
# is enough, the same as it is for a matplotlib figure.
print(fig)
