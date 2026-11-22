# =============================================================================
# Bibliography
# =============================================================================
# Every source behind the selected record, as a numbered bibliography: each
# source once, with its citations lettered below, the way Gramps' reports
# print endnotes. Each citation is written the way its own Formatted citation
# shows it (manual text, or the format chosen for it, its source or the
# tree), and the list has a Copy button.
#
# Which citations:
#   - a person: their own, and those on their names, attributes, addresses
#     and event references; their events'; their families' and those
#     families' events'
#   - a family: its own, and its events'
#   - a source: every citation of it
#   - a citation: itself
#   - anything else (an event, place, media...): its own
#
# Demonstrates:
#   - get_selected() to follow the selected record
#   - events()/families()/citations() to fetch many records in one request
#   - walking a record's data for every "citation_list", so citations on
#     names, event references and attributes are found too
#   - bibliography() to draw the result in the app's citation formats
# =============================================================================

from gramps.gen.lib.json_utils import object_to_dict


def add_citations(data, found):
    """Every handle in a "citation_list" anywhere in a record's data,
    added to found in order, each once."""
    if isinstance(data, dict):
        for key, value in data.items():
            if key == "citation_list":
                for handle in value:
                    if handle not in found:
                        found.append(handle)
            else:
                add_citations(value, found)
    elif isinstance(data, list):
        for value in data:
            add_citations(value, found)


def event_handles(data):
    return [ref["ref"] for ref in data.get("event_ref_list", [])]


selected = get_selected()
if selected is None:
    html("<i>Select a record to list its sources.</i>")
else:
    kind = type(selected).__name__
    found = []
    if kind == "Citation":
        found = [selected.handle]
    elif kind == "Source":
        found = [c["handle"] for c in citations(f"source_handle == {selected.handle!r}", limit=None)]
    else:
        data = object_to_dict(selected)
        add_citations(data, found)
        event_list = event_handles(data)
        family_list = data.get("family_list", []) if kind == "Person" else []
        # One request each for the families and the events ("handle in"
        # needs at least one handle).
        if family_list:
            for family in families(f"handle in {family_list!r}", limit=None):
                add_citations(family, found)
                event_list += event_handles(family)
        event_list = list(dict.fromkeys(event_list))
        if event_list:
            for event in events(f"handle in {event_list!r}", limit=None):
                add_citations(event, found)

    if kind == "Person":
        title = f"Sources for {name_of(selected)}"
    else:
        title = f"Sources for {kind} {selected.gramps_id}"
    if found:
        bibliography(found, title=title)
    else:
        html(f"<i>No citations for this {kind.lower()}.</i>")
