# =============================================================================
# Births by Country (Choropleth)
# =============================================================================
# A plotly choropleth of birth counts per country -- answers the question
# raised on gramps-connect issue #18 ("would I have to store ISO codes in
# my Places?"). No: each birthplace's own recorded *name* is used directly,
# via go.Choropleth(locationmode="country names") -- Plotly matches that
# against ordinary English country names ("France", "United States"), not
# the ISO-3166 codes its other locationmode expects.
#
# The country itself is never stored on the person or the event -- only on
# whichever Place their birth event points at. So this walks that place's
# own `enclosed_by` chain (Place -> Place, the same generic relationship
# hop GOQL exposes for any relationship, not special-cased for Place) up to
# MAX_HOPS levels, preferring the first ancestor typed PlaceType.COUNTRY.
#
# That preferred path needs a real Place hierarchy (enclosed_by links) with
# accurate place_type values on it, which turns out to be the exception,
# not the rule: checked against Gramps's own official example.gramps
# sample data, all 1903 people with a recorded birthplace have it as one
# flat, untyped Place record (place_type == -1, no enclosed_by at all) with
# the whole hierarchy baked into the title string itself, e.g. "Norway,
# Vestfold, Norway" or "Blois, Loir-et-Cher, Orleanais/Centre, France" --
# so two more fallbacks, weakest last:
#   1. A Country-typed ancestor in the enclosed_by chain (most reliable,
#      when a tree actually has one).
#   2. No Country type found, but the chain does go up at least one level
#      (enclosed_by is set) -- use the outermost title reached. Most
#      hand-built hierarchies put the country at the top even when nobody
#      bothered setting each level's type.
#   3. No enclosed_by at all -- split the place's own title on commas and
#      use the last segment. Not always a real place name (trailing
#      punctuation, "Orkney, Scotland." style regions Plotly won't
#      recognize as a country) but it's what's actually in the data, and
#      go.Choropleth silently skips any location string it can't match
#      rather than erroring, so a wrong guess just doesn't color anything.
#
# Demonstrates:
#   - filter()'s `what` crossing a *chain* of relationships
#     (birth -> place -> enclosed_by -> enclosed_by -> ...), not just the
#     single hop born-in.py's "birth.place.title" uses
#   - reading a Gramps enum struct (`place_type.value`, PlaceType.COUNTRY
#     == 1) back out of a filter() row -- the same struct-field shape
#     age-at-death-histogram's "birth.date.sortval" uses for Dates
#   - print(fig) on a plotly Figure built directly from go.Choropleth,
#     rendered automatically with no to_html()/embedding of its own
# =============================================================================

from collections import Counter

import plotly.graph_objects as go
from gramps.gen.lib import PlaceType

# How many "enclosed_by" hops to walk looking for a Country place. 5 covers
# even an unusually deep hierarchy (neighborhood -> city -> county -> state
# -> country) without asking filter() for arbitrarily many columns most
# trees will never use.
MAX_HOPS = 5

# ["birth.place", "birth.place.enclosed_by", "birth.place.enclosed_by.enclosed_by", ...]
hops = []
path = "birth.place"
for _ in range(MAX_HOPS):
    hops.append(path)
    path += ".enclosed_by"

# and_filters(get_filter(), ...) layers this Gramplet's own "has a
# birthplace" requirement on top of whatever filter is currently applied
# on the People view -- so filtering down to one family branch narrows the
# map the same way, instead of it always covering the whole tree.
rows = filter(
    "person",
    where=and_filters(get_filter(), "birth.place.title is not None"),
    what=[f"{hop}.title" for hop in hops] + [f"{hop}.place_type.value" for hop in hops],
    limit=5000,
)

counts = Counter()
skipped = 0
for r in rows:
    country = None
    outermost_title = None
    for hop in hops:
        title = r[f"{hop}.title"]
        if not title:
            break
        outermost_title = title
        if r[f"{hop}.place_type.value"] == PlaceType.COUNTRY:
            country = title
            break

    if country is None and outermost_title and outermost_title != r["birth.place.title"]:
        # enclosed_by went somewhere, just never hit a Country type --
        # best guess is whatever's at the top of the chain.
        country = outermost_title

    if country is None:
        # No enclosed_by at all -- the birthplace is one flat record, so
        # fall back to its own title's last comma-separated segment
        # ("Blois, Loir-et-Cher, Orleanais/Centre, France" -> "France").
        segment = r["birth.place.title"].rsplit(",", 1)[-1].strip().rstrip(".")
        country = segment or None

    if country:
        counts[country] += 1
    else:
        skipped += 1

if not counts:
    st.write("No birthplace text in the current list to plot.")
else:
    fig = go.Figure(
        go.Choropleth(
            locations=list(counts.keys()),
            locationmode="country names",
            z=list(counts.values()),
            colorscale="Viridis",
            colorbar_title="Births",
        )
    )
    title = f"Births by country ({sum(counts.values())} people"
    if skipped:
        title += f", {skipped} skipped -- no Country place in their chain"
    title += ")"
    fig.update_layout(
        title_text=title,
        geo=dict(showframe=False, showcoastlines=True),
        margin=dict(l=0, r=0, t=50, b=0),
    )

    # That's it -- no to_html()/embedding to write by hand. A bare print(fig)
    # is enough.
    print(fig)
