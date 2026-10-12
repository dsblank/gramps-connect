# =============================================================================
# Installing a third-party package with %pip install
# =============================================================================
# Sorts surnames the way a phone book does -- ignoring accents, so "Muller"
# and "Müller" land next to each other -- using the `unidecode` package
# from PyPI, installed with the same `%pip install` line you'd use in a
# Jupyter notebook.
#
# Demonstrates:
#   - %pip install (Jupyter-magic syntax -- rewritten into a real
#     micropip.install() call for you before your code runs)
#   - only works for *pure-Python* packages (no compiled/C-extension code)
#     -- pygal, plotly and matplotlib don't need this because they're
#     pre-bundled, but most small pure-Python utility packages on PyPI
#     install fine this way
# =============================================================================

# Must be its own line, at the top, exactly like in a Jupyter notebook --
# it's rewritten to `await micropip.install(['unidecode'])` before your
# code runs, so writing it any other way (e.g. inside an if) won't work.
%pip install unidecode

from unidecode import unidecode

# filter() with what= rather than whole records: only surname is needed
# here, and people() would download every field of every person to get it
# -- see Pygal Charts' own comment on this same trade-off. limit=None means
# everyone, fetched in pages of 1000 behind the scenes.
rows = filter("person", what=["surname"], limit=None)
surnames = sorted({r.surname for r in rows if r.surname}, key=unidecode)

set_column_titles("Surname", "Sorts as")
for surname in surnames:
    ascii_form = unidecode(surname)
    # Only show the ones where accent-folding actually changed anything --
    # otherwise this table is mostly identical pairs.
    if ascii_form != surname:
        row(surname, ascii_form)
