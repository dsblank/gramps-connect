# gramps-connect-sdk

A Python client for [`gramps-web-api`](https://github.com/gramps-project/gramps-web-api),
authenticated with a personal API key instead of a username/password login.

```python
from gramps_connect_sdk import Client

client = Client(base_url="https://your-server.example.com", api_key="...")

# fetch a single object by handle
person = client.people.get("abc123")

# list/filter (thin wrapper over GET /api/<type>/)
smiths = client.people.list(gramps_id="I0001")

# fast, SQL-pushed-down structured query (POST /api/<type>/query/)
matches = client.people.query(where_expr='primary_name.surname_list[0].surname == "Smith"')

# create / update / delete
new_event = client.events.create({"_class": "Event", "description": "Birth"})
client.places.update("p1", {"_class": "Place", "name": {...}})
client.tags.delete("t1")
```

`client` exposes one `ObjectResource` per primary object type: `people`,
`families`, `events`, `places`, `repositories`, `sources`, `citations`,
`media`, `notes`, `tags` — each with `.get(handle)`, `.list(**params)`,
`.query(where_expr=..., **body)`, `.create(data)`, `.update(handle, data)`,
`.delete(handle)`. `Client.create_objects()` / `Client.delete_objects()`
cover bulk multi-object transactions via `/api/objects/`.

`Client.get/post/put/delete(path, ...)` are also public, for any endpoint
not yet wrapped by an `ObjectResource`.

## Gramps-core-style access (optional)

Everything above returns plain dicts. `Client` also mixes in a second,
gramps-core-flavored surface — `get_person()`, `get_person_from_gramps_id()`,
`iter_people()`, `get_number_of_people()`, `get_default_person()`, and the
equivalent set for every other type — mirroring the method names on
`gramps.gen.db.generic.py`'s `DbReadBase`, the same interface Gramps desktop
itself is built on:

```python
person = client.get_person("abc123")
print(person.get_primary_name().get_surname())   # a real gramps.gen.lib.Person

for family in client.iter_families():
    print(family.get_gramps_id())

client.people.create(person)   # accepts the object directly, no dict needed
```

This needs the `gramps` package itself, since it deserializes gramps-web-api's
`to_struct()`-shaped JSON responses back into real `gramps.gen.lib` objects
via `gramps.gen.lib.json_utils.data_to_object` — the exact classes/methods
Gramps desktop uses. It's an **optional extra**, not installed by default:

```sh
pip install "gramps-connect-sdk[gramps-objects]"
```

`gramps` on PyPI unconditionally imports PyGObject (`gi.repository.GLib`)
even for its plain object model, and PyGObject needs system GTK/girepository
dev packages to build (Debian/Ubuntu: `apt install libgirepository-2.0-dev
gir1.2-glib-2.0 gobject-introspection`; similar on other platforms) — too
heavy to force on every SDK user, since the dict-based resources above cover
the same data without it. Calling a gramps-core-style method without the
extra installed raises a clear `ImportError` explaining what's missing;
`client.people`/`.families`/... and `get_number_of_*()` (header-only, no
deserialization) work either way.

## Auth model

An API key is meant to be a long-lived personal token, generated from the
gramps-connect UI, sent as `Authorization: Bearer <key>` on every request —
unlike `gramps-web-api`'s username/password flow (short-lived JWT + refresh
token rotation), there's no login step or expiry handling needed here: the
key is valid until revoked.

**Backend status**: `gramps-web-api` already has a persistent-access-token
mechanism (`gramps_webapi/auth/__init__.py`: `rotate_user_access_token` /
`revoke_user_access_token` / `has_user_access_token`, exposed via
`/api/users/-/access-tokens/<scope>/`) but today it's scoped only to
`anniversaries_ics` (a calendar-feed use case). Using it as a general-purpose
API key for this SDK requires broadening that scope — and the gramps-connect
GUI panel to generate/revoke one — in follow-up work; this package assumes
that mechanism once it exists.

## Errors

Non-2xx responses raise a typed exception (all subclasses of
`GrampsConnectError`, from `gramps_connect_sdk.exceptions`):

- `AuthenticationError` — 401/403
- `NotFoundError` — 404
- `ValidationError` — 422
- `ApiError` — any other non-2xx status

Each carries `.status_code` and `.payload` (the parsed JSON error body, if
any).

## Development

```sh
cd sdk
pip install -e ".[dev]"
pytest
```
