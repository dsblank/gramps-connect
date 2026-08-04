"""HTTP client for gramps-web-api, authenticated with a personal API key."""

from __future__ import annotations

from typing import Any, Optional

import requests

from .exceptions import ApiError, AuthenticationError, NotFoundError, ValidationError
from .gramps_style import GrampsStyleMixin
from .gramps_types import GRAMPS_TYPES
from .resources import ObjectResource

# gramps-web-api mounts its whole REST surface under this prefix
# (gramps_webapi/const.py: API_PREFIX). `base_url` is the server root, e.g.
# "https://example.com" or "http://localhost:5003", matching what app/'s
# VITE_API_BASE already points at.
_API_PREFIX = "/api"

_ERROR_CLASSES = {
    401: AuthenticationError,
    403: AuthenticationError,
    404: NotFoundError,
    422: ValidationError,
}


class Client(GrampsStyleMixin):
    """Client for a gramps-web-api server, authenticated via an API key.

    Unlike gramps-web-api's username/password login flow (short-lived JWTs
    needing refresh), an API key is a long-lived personal token generated
    from the gramps-connect UI, sent as a bearer token on every request and
    valid until revoked -- so there is no login step or token refresh here.

    Two ways to reach the same data:

    - `client.people`, `.families`, ... : generic REST resources returning
      raw dicts (`.get`, `.list`, `.query`, `.create`, `.update`, `.delete`).
    - `client.get_person(handle)`, `.iter_people()`, ... : gramps-core-style
      accessors (mirroring `gramps.gen.db.generic.py`'s `DbReadBase`)
      returning real `gramps.gen.lib` objects (`Person`, `Family`, ...), with
      the same methods you'd call against a local Gramps database
      (`.get_primary_name()`, `.get_gender()`, `.get_event_ref_list()`, ...).

    Example:
        client = Client(base_url="https://example.com", api_key="...")
        person = client.get_person(handle)
        print(person.get_primary_name().get_surname())
        matches = client.people.query(where_expr='surname == "Smith"')
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        timeout: float = 30.0,
        session: Optional[requests.Session] = None,
    ):
        if not base_url:
            raise ValueError("base_url is required")
        if not api_key:
            raise ValueError("api_key is required")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._api_key = api_key
        self._session = session or requests.Session()

        for gramps_type in GRAMPS_TYPES:
            setattr(self, gramps_type.resource, ObjectResource(self, gramps_type.resource))

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Send an authenticated request to `<base_url>/api<path>`.

        `path` must start with "/". Returns the parsed JSON body, raw bytes
        for non-JSON responses, or None for empty (e.g. 204) responses.
        """
        response = self._send(method, path, **kwargs)
        return self._parse_body(response)

    def _send(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        """Send an authenticated request and return the raw response.

        Used by `request()` directly, and by the gramps-core-style
        accessors that also need response headers (e.g. `X-Total-Count`
        for `get_number_of_people()`), not just the parsed body.
        """
        url = f"{self.base_url}{_API_PREFIX}{path}"
        headers = kwargs.pop("headers", {}) or {}
        headers["Authorization"] = f"Bearer {self._api_key}"
        headers.setdefault("Accept", "application/json")

        response = self._session.request(
            method, url, headers=headers, timeout=self.timeout, **kwargs
        )
        self._raise_for_error(response)
        return response

    def _raise_for_error(self, response: requests.Response) -> None:
        if response.ok:
            return
        message = response.text
        payload = None
        content_type = response.headers.get("content-type", "")
        if content_type.startswith("application/json"):
            try:
                payload = response.json()
            except ValueError:
                payload = None
            if isinstance(payload, dict) and "message" in payload:
                message = payload["message"]
        error_cls = _ERROR_CLASSES.get(response.status_code, ApiError)
        raise error_cls(response.status_code, message, payload)

    def _parse_body(self, response: requests.Response) -> Any:
        if not response.content:
            return None
        content_type = response.headers.get("content-type", "")
        if content_type.startswith("application/json"):
            return response.json()
        return response.content

    def get(self, path: str, *, params: Optional[dict] = None) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, *, json: Any = None, params: Optional[dict] = None) -> Any:
        return self.request("POST", path, json=json, params=params)

    def put(self, path: str, *, json: Any = None, params: Optional[dict] = None) -> Any:
        return self.request("PUT", path, json=json, params=params)

    def delete(self, path: str, *, json: Any = None, params: Optional[dict] = None) -> Any:
        return self.request("DELETE", path, json=json, params=params)

    def create_objects(self, objects: list[dict]) -> Any:
        """Create multiple objects of any type in one transaction.

        Each dict must be a full Gramps object struct (as returned by e.g.
        `client.people.get(handle)`) with `_class` set, per gramps-web-api's
        `/api/objects/` bulk-create resource.
        """
        return self.post("/objects/", json=objects)

    def delete_objects(self, namespace: str, handles: list[str]) -> Any:
        """Delete multiple objects of one type by handle in one transaction.

        `namespace` is the object type's plural form, e.g. "people".
        """
        return self.post(
            "/objects/delete-by-handle/",
            json={"namespace": namespace, "handles": handles},
        )
