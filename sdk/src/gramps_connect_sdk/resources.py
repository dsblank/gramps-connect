"""Generic CRUD/query access to one gramps-web-api object type.

An `ObjectResource` is created once per type (people, families, events, ...)
and attached to the `Client` under that name -- e.g. `client.people`. All ten
types share the same REST shape in gramps-web-api
(`/api/<type>/`, `/api/<type>/<handle>`, `/api/<type>/query/`), so one class
covers all of them rather than hand-writing ten near-identical ones.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional, Union

if TYPE_CHECKING:
    from gramps.gen.lib.primaryobj import BasicPrimaryObject as GrampsObject

    from .client import Client

# Accepted directly by create()/update(): either a raw struct dict, or a real
# gramps.gen.lib object -- e.g. one just returned by Client.get_person() --
# converted to a dict the same way gramps-web-api itself would serialize it.
ObjectData = Union[dict, "GrampsObject"]


def _as_dict(data: ObjectData) -> dict:
    if isinstance(data, dict):
        return data
    # `gramps` (needed to recognize/convert a real gramps.gen.lib object) is
    # an optional dependency -- see gramps_style.py's module docstring for
    # why -- so this import is deferred to here, only reached when `data`
    # isn't already a plain dict.
    try:
        from gramps.gen.lib.json_utils import object_to_dict
        from gramps.gen.lib.primaryobj import BasicPrimaryObject
    except ImportError as exc:
        raise ImportError(
            "create()/update() only accept a gramps.gen.lib object when the "
            "optional 'gramps' dependency is installed "
            "(pip install gramps-connect-sdk[gramps-objects]); pass a plain "
            "dict instead, or install that extra."
        ) from exc
    if isinstance(data, BasicPrimaryObject):
        return object_to_dict(data)
    raise TypeError(
        f"Expected a dict or gramps.gen.lib object, got {type(data).__name__}"
    )


class ObjectResource:
    def __init__(self, client: "Client", name: str):
        self._client = client
        self._name = name

    def get(self, handle: str, **params: Any) -> dict:
        """Fetch a single object by handle.

        `params` forwards gramps-web-api's GET query args, e.g.
        `locale=`, `profile=`, `extend=`.
        """
        return self._client.get(f"/{self._name}/{handle}", params=params)

    def list(self, **params: Any) -> list[dict]:
        """List/filter objects.

        `params` forwards gramps-web-api's GET query args, e.g. `gramps_id=`,
        `handles=`, `gql=`, `oql=`, `sort=`, `page=`, `pagesize=`.
        """
        return self._client.get(f"/{self._name}/", params=params)

    def query(self, where_expr: Optional[str] = None, **body: Any) -> Any:
        """Run a fast, SQL-pushed-down query via POST `/api/<type>/query/`.

        `where_expr` is a gramps-object-query-language boolean expression,
        e.g. `'surname == "Smith" and birth_year > 1900'`. Additional
        keyword args forward the endpoint's other body fields: `select`,
        `where` (structured alternative to `where_expr`), `order_by`,
        `limit` (default 50, max 1000), `after` (keyset pagination cursor),
        `locale`, `count`.
        """
        if where_expr is not None:
            body["where_expr"] = where_expr
        return self._client.post(f"/{self._name}/query/", json=body)

    def create(self, data: ObjectData) -> Any:
        """Create a new object of this type.

        `data` is either a raw struct dict or a real `gramps.gen.lib` object
        (e.g. one built locally with `gramps.gen.lib.Person()`, or one
        fetched via `Client.get_person()` and modified in place).
        """
        return self._client.post(f"/{self._name}/", json=_as_dict(data))

    def update(self, handle: str, data: ObjectData) -> Any:
        """Replace an existing object by handle.

        `data` is either a raw struct dict or a real `gramps.gen.lib` object
        -- see `create()`.
        """
        return self._client.put(f"/{self._name}/{handle}", json=_as_dict(data))

    def delete(self, handle: str) -> Any:
        """Delete a single object by handle."""
        return self._client.delete(f"/{self._name}/{handle}")
