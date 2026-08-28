# =============================================================================
# 09 - Installing a third-party package with %pip install
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
#     -- pygal and matplotlib (05/06) don't need this because they're
#     pre-bundled, but most small pure-Python utility packages on PyPI
#     install fine this way
# =============================================================================

# Must be its own line, at the top, exactly like in a Jupyter notebook --
# it's rewritten to `await micropip.install(['unidecode'])` before your
# code runs, so writing it any other way (e.g. inside an if) won't work.
%pip install unidecode

from unidecode import unidecode

# filter() rather than people(): only surname is needed here, and
# people() would mean 5000 full-object network fetches to get it -- see
# 05_pygal_charts.py's own comment on this same trade-off.
rows = filter("person", what=["surname"], limit=5000)
surnames = sorted({r.surname for r in rows if r.surname}, key=unidecode)

columns("Surname", "Sorts as")
for surname in surnames:
    ascii_form = unidecode(surname)
    # Only show the ones where accent-folding actually changed anything --
    # otherwise this table is mostly identical pairs.
    if ascii_form != surname:
        row(surname, ascii_form)
