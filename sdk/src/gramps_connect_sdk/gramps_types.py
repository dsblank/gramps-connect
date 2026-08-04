"""Mapping between gramps-web-api's REST resource names and gramps core's
object classes -- drives the gramps-core-style methods in `gramps_style.py`
(`get_person`, `iter_families`, `get_number_of_events`, ...), mirroring the
naming convention in `gramps.gen.db.generic.py`'s `DbReadBase`.
"""

from __future__ import annotations

from typing import NamedTuple


class GrampsType(NamedTuple):
    resource: str  # gramps-web-api plural resource name, e.g. "people"
    class_name: str  # gramps.gen.lib class name, e.g. "Person"
    singular: str  # method-name singular, e.g. "person" (get_person)
    plural: str  # method-name plural, e.g. "people" (iter_people) -- not
    # always `resource` (People -> person/people is regular, but this also
    # keeps the two concepts distinct in case a future type needs it)
    has_gramps_id: bool  # Tag is the one primary object type without one


# Order matches gramps.gen.db.generic.py's own listing.
GRAMPS_TYPES: list[GrampsType] = [
    GrampsType("people", "Person", "person", "people", True),
    GrampsType("families", "Family", "family", "families", True),
    GrampsType("events", "Event", "event", "events", True),
    GrampsType("places", "Place", "place", "places", True),
    GrampsType("repositories", "Repository", "repository", "repositories", True),
    GrampsType("sources", "Source", "source", "sources", True),
    GrampsType("citations", "Citation", "citation", "citations", True),
    GrampsType("media", "Media", "media", "media", True),
    GrampsType("notes", "Note", "note", "notes", True),
    GrampsType("tags", "Tag", "tag", "tags", False),
]
