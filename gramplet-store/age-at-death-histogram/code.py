# =============================================================================
# 06 - A histogram with matplotlib
# =============================================================================
# Age-at-death distribution, as a matplotlib histogram. matplotlib is
# pre-bundled the same way pygal is (see 05_pygal_charts.py) -- a plain
# import works offline, no %pip install needed.
#
# Demonstrates:
#   - print(fig) -- a plain print() of a matplotlib figure (or a bare
#     trailing `plt`) is recognized automatically and rendered as an
#     image; you never need to save/encode it by hand
#   - computing something (age at death) that isn't a field Gramps stores
#     directly, from two dates that are
# =============================================================================

import matplotlib.pyplot as plt

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
rows = filter(
    "person",
    where="birth.date.sortval is not None and death.date.sortval is not None",
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

fig, ax = plt.subplots()
ax.hist(ages, bins=20)
ax.set_xlabel("Age at death (years)")
ax.set_ylabel("Number of people")
ax.set_title(f"Age at death ({len(ages)} people with both dates recorded)")

# That's it -- no savefig()/base64 encoding to write by hand. A bare
# `print(fig)` (or ending the script with a trailing `plt`, the habit
# JupyterLite/IPython users already have) is enough.
print(fig)
