# =============================================================================
# Age at Death by Decade
# =============================================================================
# The median age at death for each decade -- of birth, or of death -- as
# an interactive plotly bar chart, with the number of people behind each
# bar in its hover text. Only people with both a birth and a death date
# count.
#
# Demonstrates:
#   - a chart in a Gramplet window: a plain print(fig) of a plotly Figure
#     renders it interactively
#   - an st.radio that redraws the chart when changed (each change reruns
#     this code)
#   - get_filter("person") to follow a filtered People list, if one is open
#   - st.progress() while it works, removed with .empty() before the chart
# =============================================================================

from statistics import median
from plotly.subplots import make_subplots

BIRTH = "birth.date"
DEATH = "death.date"

group_by = st.radio("Group by decade of", ["birth", "death"], horizontal=True)

bar = st.progress(0, text="Loading birth and death dates...")
rows = filter(
    "person",
    where=and_filters(get_filter("person"), "birth.date.sortval > 0 and death.date.sortval > 0"),
    what=[BIRTH, DEATH],
    limit=None,
)

# Ages by decade. sortval is a day count, so the difference is an age in
# days; dateval[2] is the year. Anything negative or over 110 is almost
# certainly a data-entry mistake and is left out rather than skewing a bar.
ages = {}
for i, person in enumerate(rows):
    bar.progress((i + 1) / len(rows), text="Working out ages...")
    birth, death = person[BIRTH], person[DEATH]
    age = (death["sortval"] - birth["sortval"]) / 365.25
    year = (birth if group_by == "birth" else death)["dateval"][2]
    if 0 <= age <= 110 and year:
        ages.setdefault(year // 10 * 10, []).append(age)

bar.empty()
if not ages:
    st.info("No one here has both a birth and a death date recorded.")
else:
    decades = sorted(ages)
    fig = make_subplots()
    fig.add_bar(
        x=[f"{d}s" for d in decades],
        y=[round(median(ages[d]), 1) for d in decades],
        customdata=[len(ages[d]) for d in decades],
        hovertemplate="%{x}: median %{y} years (%{customdata} people)<extra></extra>",
    )
    fig.update_layout(
        title=f"Median age at death by decade of {group_by} ({len(rows)} people)",
        xaxis_title=f"Decade of {group_by}",
        yaxis_title="Median age at death (years)",
    )
    print(fig)
