"""Gramps-core-style accessors, mirroring `gramps.gen.db.generic.py`'s
`DbReadBase` method-naming convention (`get_person_from_handle`,
`get_family_from_gramps_id`, `iter_people`, `get_number_of_events`, ...) but
backed by an HTTP round trip to gramps-web-api instead of a local database.

Every response struct gramps-web-api returns is `to_struct()`-shaped JSON --
exactly what `gramps.gen.lib.json_utils.data_to_object` expects, so these
methods hand back real `gramps.gen.lib` objects (`Person`, `Family`, ...),
not dicts: the same methods you'd call against a local Gramps database
(`.get_primary_name()`, `.get_gender()`, `.get_event_ref_list()`, ...) work
here too.

`Client` (see `client.py`) mixes this in alongside its generic, dict-based
`.people`/`.families`/... resources -- this is a second, more ergonomic way
to reach the same data, not a replacement for the first.

`gramps` is an *optional* dependency (`pip install
gramps-connect-sdk[gramps-objects]`): the PyPI package unconditionally
imports PyGObject (`gi.repository.GLib`) even just to build the plain
`gramps.gen.lib` object model, and PyGObject needs system GTK/girepository
dev packages to install -- too heavy to force on every SDK user when most of
these methods' logic (everything except turning the response into a typed
object) doesn't need it. So the import is deferred to first use via
`_data_to_object()` below, with a clear error if it's missing, rather than
done at module import time. `get_number_of_*` needs no such import at all --
it only reads a response header.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterator, Optional

if TYPE_CHECKING:
    from gramps.gen.lib import Citation, Event, Family, Media, Note, Person
    from gramps.gen.lib import Place, Repository, Source, Tag


def _data_to_object():
    try:
        from gramps.gen.lib.json_utils import data_to_object
    except ImportError as exc:
        raise ImportError(
            "This method needs the optional 'gramps' dependency (pip "
            "install gramps-connect-sdk[gramps-objects]; also requires "
            "system GTK/girepository dev packages -- see this SDK's "
            "README). For a dependency-free alternative returning plain "
            "dicts, use the equivalent client.<type>.get(...)/.list()."
        ) from exc
    return data_to_object


class GrampsStyleMixin:
    """Mixed into `Client`; methods below assume `self.get`/`self._send`."""

    # -- generic helpers, one per access pattern, shared by every type below --

    def _get_typed(self, resource: str, handle: str):
        data_to_object = _data_to_object()
        return data_to_object(self.get(f"/{resource}/{handle}"))  # type: ignore[attr-defined]

    def _get_typed_from_gramps_id(self, resource: str, gramps_id: str):
        data_to_object = _data_to_object()
        # gramps-web-api's collection endpoint 404s server-side for an
        # unknown gramps_id, so this never needs its own "not found" check.
        matches = self.get(  # type: ignore[attr-defined]
            f"/{resource}/", params={"gramps_id": gramps_id}
        )
        return data_to_object(matches[0])

    def _iter_typed(self, resource: str) -> Iterator:
        data_to_object = _data_to_object()
        for data in self.get(f"/{resource}/"):  # type: ignore[attr-defined]
            yield data_to_object(data)

    def _count_typed(self, resource: str) -> int:
        # pagesize=1 keeps the body small; X-Total-Count reflects the count
        # before pagination is applied (see gramps-web-api's base.py).
        response = self._send(  # type: ignore[attr-defined]
            "GET", f"/{resource}/", params={"page": 1, "pagesize": 1}
        )
        total = response.headers.get("X-Total-Count")
        if total is not None:
            return int(total)
        return len(self._parse_body(response) or [])  # type: ignore[attr-defined]

    # -- people --

    def get_person(self, handle: str) -> "Person":
        """Return the `Person` with this handle."""
        return self._get_typed("people", handle)

    def get_person_from_gramps_id(self, gramps_id: str) -> "Person":
        """Return the `Person` with this Gramps ID (e.g. "I0001")."""
        return self._get_typed_from_gramps_id("people", gramps_id)

    def iter_people(self) -> Iterator["Person"]:
        """Iterate over every `Person` in the tree."""
        return self._iter_typed("people")

    def get_number_of_people(self) -> int:
        return self._count_typed("people")

    def get_default_person(self) -> Optional["Person"]:
        """Return the tree's configured default/home person, or None."""
        handle = self.get("/metadata/").get("default_person")  # type: ignore[attr-defined]
        return self.get_person(handle) if handle else None

    # -- families --

    def get_family(self, handle: str) -> "Family":
        return self._get_typed("families", handle)

    def get_family_from_gramps_id(self, gramps_id: str) -> "Family":
        return self._get_typed_from_gramps_id("families", gramps_id)

    def iter_families(self) -> Iterator["Family"]:
        return self._iter_typed("families")

    def get_number_of_families(self) -> int:
        return self._count_typed("families")

    # -- events --

    def get_event(self, handle: str) -> "Event":
        return self._get_typed("events", handle)

    def get_event_from_gramps_id(self, gramps_id: str) -> "Event":
        return self._get_typed_from_gramps_id("events", gramps_id)

    def iter_events(self) -> Iterator["Event"]:
        return self._iter_typed("events")

    def get_number_of_events(self) -> int:
        return self._count_typed("events")

    # -- places --

    def get_place(self, handle: str) -> "Place":
        return self._get_typed("places", handle)

    def get_place_from_gramps_id(self, gramps_id: str) -> "Place":
        return self._get_typed_from_gramps_id("places", gramps_id)

    def iter_places(self) -> Iterator["Place"]:
        return self._iter_typed("places")

    def get_number_of_places(self) -> int:
        return self._count_typed("places")

    # -- repositories --

    def get_repository(self, handle: str) -> "Repository":
        return self._get_typed("repositories", handle)

    def get_repository_from_gramps_id(self, gramps_id: str) -> "Repository":
        return self._get_typed_from_gramps_id("repositories", gramps_id)

    def iter_repositories(self) -> Iterator["Repository"]:
        return self._iter_typed("repositories")

    def get_number_of_repositories(self) -> int:
        return self._count_typed("repositories")

    # -- sources --

    def get_source(self, handle: str) -> "Source":
        return self._get_typed("sources", handle)

    def get_source_from_gramps_id(self, gramps_id: str) -> "Source":
        return self._get_typed_from_gramps_id("sources", gramps_id)

    def iter_sources(self) -> Iterator["Source"]:
        return self._iter_typed("sources")

    def get_number_of_sources(self) -> int:
        return self._count_typed("sources")

    # -- citations --

    def get_citation(self, handle: str) -> "Citation":
        return self._get_typed("citations", handle)

    def get_citation_from_gramps_id(self, gramps_id: str) -> "Citation":
        return self._get_typed_from_gramps_id("citations", gramps_id)

    def iter_citations(self) -> Iterator["Citation"]:
        return self._iter_typed("citations")

    def get_number_of_citations(self) -> int:
        return self._count_typed("citations")

    # -- media --

    def get_media(self, handle: str) -> "Media":
        return self._get_typed("media", handle)

    def get_media_from_gramps_id(self, gramps_id: str) -> "Media":
        return self._get_typed_from_gramps_id("media", gramps_id)

    def iter_media(self) -> Iterator["Media"]:
        return self._iter_typed("media")

    def get_number_of_media(self) -> int:
        return self._count_typed("media")

    # -- notes --

    def get_note(self, handle: str) -> "Note":
        return self._get_typed("notes", handle)

    def get_note_from_gramps_id(self, gramps_id: str) -> "Note":
        return self._get_typed_from_gramps_id("notes", gramps_id)

    def iter_notes(self) -> Iterator["Note"]:
        return self._iter_typed("notes")

    def get_number_of_notes(self) -> int:
        return self._count_typed("notes")

    # -- tags (no Gramps ID, unlike every other primary object type) --

    def get_tag(self, handle: str) -> "Tag":
        return self._get_typed("tags", handle)

    def iter_tags(self) -> Iterator["Tag"]:
        return self._iter_typed("tags")

    def get_number_of_tags(self) -> int:
        return self._count_typed("tags")
