// See types.ts for what this PoC is for. Module worker (loaded via
// `new Worker(new URL(...), { type: "module" })` in PyodidePocPanel.tsx) so
// it can `import "pyodide"` directly -- Vite bundles the loader, while the
// actual asm/wasm/stdlib data files are fetched at runtime from indexURL
// (public/pyodide/, populated by scripts/copy-wasm.mjs).
import { loadPyodide, type PyodideInterface } from "pyodide";
import { API_BASE } from "../config";
import { autoAwaitGrampletCode } from "./autoAwait";
import { OBJECT_QUERY_ENDPOINTS, objectEndpointBase } from "./objectEndpoints";
import type { PyodideWorkerRequest, PyodideWorkerResponse } from "./types";

// Loaded once per worker instance and reused across messages -- the ~14MB
// fetch + WASM instantiation is a several-hundred-ms-to-few-seconds cost
// not worth paying per run.
let pyodidePromise: Promise<PyodideInterface> | null = null;
function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({ indexURL: "/pyodide/" });
  }
  return pyodidePromise;
}

// Set fresh from each RunGrampletRequest, read by the bridge functions
// below -- the worker can't call getToken() itself (reads localStorage,
// not available inside a Worker), so the main thread resolves a token and
// hands it over per-message instead. See types.ts's RunGrampletRequest
// doc comment for the known "not refreshed mid-run" limitation.
let currentToken = "";

// The JS side of filter()/get_object() -- registered into Pyodide once
// (see BOOTSTRAP_PY) as the `_gramps_connect_bridge` module, wrapped by
// Python functions of the same name that are what a Gramplet actually
// calls. Plain positional args throughout (no reliance on Python-kwargs
// calling a JS function, which isn't a normal JsProxy feature) -- the
// Python wrappers are where the nicer keyword-argument surface lives.
// Every value crossing the boundary, in both directions, is a plain
// string -- found live, twice: an awaited JS async function's resolved
// object/array crosses as a PyProxy tied to Pyodide's internal
// coroutine-driving generator ("pyodide.ffi.JsException: ... This
// borrowed proxy was automatically destroyed when an iterator was
// exhausted"), and the *same* error recurred just from passing a Python
// list (`what`/`order`) as an argument into the JS call, not just from
// using a returned one. A plain string has no proxy lifetime to manage at
// all on either side, so this sidesteps the whole class of bug rather
// than finding the exact right place to pin/copy each proxy.
const bridge = {
  async filter(objectType: string, argsJson: string): Promise<string> {
    const args = JSON.parse(argsJson) as {
      where: string | null;
      what: string[] | null;
      order: unknown;
      limit: number;
    };
    const endpoint = OBJECT_QUERY_ENDPOINTS[objectType];
    if (!endpoint) throw new Error(`filter(): unknown object type ${JSON.stringify(objectType)}`);
    // A dotted entry ("birth.date", "father.gramps_id") means "cross a
    // relationship" -- gramps-web-api's /query/ endpoint only recognizes
    // that as a {"json_path": [...]} select entry, never a plain dotted
    // string (a bare string is always a literal flat-column lookup there,
    // confirmed live: passing "birth.date" straight through raised
    // "unknown or disallowed column: 'birth.date'"). Splitting on "." only
    // -- not the fuller {json_path: [...]} bracket-index syntax
    // object_query.py also supports (e.g. "surname_list[0].surname") --
    // covers what a Gramplet actually needs a cross-relationship field
    // for (birth/death/father/mother/place/... one hop, plain field).
    const select = ["handle", ...(args.what ?? []).map((entry) => (entry.includes(".") ? { json_path: entry.split(".") } : entry))];
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
      body: JSON.stringify({
        select,
        where_expr: args.where ?? undefined,
        order_by: args.order ?? undefined,
        limit: args.limit,
      }),
    });
    if (!res.ok) throw new Error(`filter(): ${res.status} ${await res.text()}`);
    const page = (await res.json()) as { items: unknown[] };
    return JSON.stringify(page.items);
  },
  async getObject(objectType: string, handle: string): Promise<string> {
    const base = objectEndpointBase(objectType);
    if (!base) throw new Error(`get_object(): unknown object type ${JSON.stringify(objectType)}`);
    const res = await fetch(`${API_BASE}${base}${encodeURIComponent(handle)}`, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    if (!res.ok) throw new Error(`get_object(): ${res.status} ${await res.text()}`);
    return res.text();
  },
  // Lazy micropip install of the minimal gramps wheel -- only called from
  // get_object()'s Python wrapper on its first real use, not paid by a
  // Gramplet that only ever calls filter().
  async ensureGramps(): Promise<void> {
    await getGramps(await getPyodide());
  },
};

// The same 3 stubs scripts/build-gramps-wheel.py's install_stubs()
// installs to *verify* the wheel under plain CPython -- keep these two in
// sync. Must run before the first `import gramps...` anywhere: gi for
// gen/const.py's XDG-dir import, orjson (plain-json-backed -- see that
// script's docstring point 2 for why this is correct, not just
// expedient) for gen/lib/json_utils.py's module-level `import orjson`,
// and a stubbed ResourcePath so gen/const.py's `ResourcePath()` call
// doesn't sys.exit(1) hunting for authors.xml/locale/images this minimal
// wheel deliberately doesn't ship.
const INSTALL_GRAMPS_STUBS_PY = `
import sys, types, json

def _install_gramps_stubs():
    glib = types.ModuleType("gi.repository.GLib")
    glib.GError = type("GError", (Exception,), {})
    glib.UserDirectory = type("UserDirectory", (), {"DIRECTORY_PICTURES": "PICTURES"})
    glib.get_user_data_dir = lambda: "/gramps-wheel-stub/data"
    glib.get_user_config_dir = lambda: "/gramps-wheel-stub/config"
    glib.get_user_cache_dir = lambda: "/gramps-wheel-stub/cache"
    glib.get_user_special_dir = lambda directory: None
    repository = types.ModuleType("gi.repository")
    repository.GLib = glib
    gi = types.ModuleType("gi")
    gi.require_version = lambda namespace, version: None
    gi.repository = repository
    sys.modules["gi"] = gi
    sys.modules["gi.repository"] = repository
    sys.modules["gi.repository.GLib"] = glib

    orjson = types.ModuleType("orjson")
    orjson.loads = json.loads
    orjson.dumps = lambda obj, default=None: json.dumps(obj, default=default).encode()
    sys.modules["orjson"] = orjson

    resourcepath = types.ModuleType("gramps.gen.utils.resourcepath")
    class ResourcePath:
        def __init__(self):
            self.data_dir = "/gramps-wheel-stub/data"
            self.image_dir = "/gramps-wheel-stub/images"
            self.doc_dir = "/gramps-wheel-stub/doc"
            self.locale_dir = "/gramps-wheel-stub/locale"
    resourcepath.ResourcePath = ResourcePath
    sys.modules["gramps.gen.utils.resourcepath"] = resourcepath

_install_gramps_stubs()
import gramps.gen.lib  # noqa: E402 -- proves the stubs above actually work
`;

// Lazy + cached like getPyodide() above: only paid the first time a
// Gramplet's get_object() call actually runs. Fetches manifest.json
// (written by scripts/copy-wasm.mjs alongside the wheel) rather than
// hardcoding the wheel's version-stamped filename.
let grampsPromise: Promise<void> | null = null;
function getGramps(pyodide: PyodideInterface): Promise<void> {
  if (!grampsPromise) {
    grampsPromise = (async () => {
      const manifestRes = await fetch("/gramps-wheel/manifest.json");
      if (!manifestRes.ok) {
        throw new Error(
          "no gramps wheel found -- run scripts/build-gramps-wheel.py, then rerun scripts/copy-wasm.mjs (or `npm install`)"
        );
      }
      const { wheel } = (await manifestRes.json()) as { wheel: string };
      await pyodide.loadPackage("micropip");
      const micropip = pyodide.pyimport("micropip");
      await micropip.install(`/gramps-wheel/${wheel}`);
      await pyodide.runPythonAsync(INSTALL_GRAMPS_STUBS_PY);
    })();
  }
  return grampsPromise;
}

// filter()/get_object(): the Python-facing half of the bridge above.
// _fix_object_dict()/_get_class_name()/_set_type_from_string() are
// vendored from gramps-web-api (AGPL-3.0-or-later),
// gramps_webapi/api/resources/util.py -- Copyright (C) 2020-2025 David
// Straub, Copyright (C) 2020 Christopher Horn,
// https://github.com/gramps-project/gramps-web-api -- the exact converter
// gramps-web-api's own generic object PUT uses to turn its REST/editing
// JSON shape (enums as bare strings, no `_class` markers -- what
// get_object()'s raw fetch returns) back into the shape
// gramps.gen.lib.json_utils.data_to_object() actually expects (`_class`-
// tagged at every nested level) -- confirmed live: calling data_to_object()
// directly on the REST shape raises KeyError('_class') from inside
// convert_state_to_object(), since that shape and data_to_object()'s
// expected shape are two different gramps serializations that happen to
// look similar at the top level.
const BOOTSTRAP_PY = `
import _gramps_connect_bridge as _bridge

_gramps_ready = False

async def _ensure_gramps():
    """Installs the minimal gramps wheel (once, cached via _gramps_ready)
    so Gramps's own gramps.gen.lib.json_utils machinery -- DataDict,
    data_to_object -- can be imported."""
    global _gramps_ready
    if not _gramps_ready:
        await _bridge.ensureGramps()  # installs the wheel + runs _install_gramps_stubs() itself
        _gramps_ready = True


async def filter(object_type, where=None, what=None, order=None, limit=50):
    """Cheap: gramps-web-api's existing fast /query/ endpoint, called
    directly from this worker. Returns each result as Gramps's own
    DataDict (gramps.gen.lib.json_utils) -- a plain dict of just the
    requested fields ('what'), with '.attr' access too -- never a real
    gramps.gen.lib object. A 'what' entry may cross one relationship with
    a dotted name (e.g. "birth.date", "father.gramps_id") to reach a
    field on the related record; the response key is that same dotted
    string. 'where' is a where_expr string (e.g. 'gender == 1'), 'order'
    is a list of {"column": ..., "direction": "asc"|"desc"}. Installs the
    minimal gramps wheel on first use, just to make DataDict importable --
    see _ensure_gramps()."""
    import json as _json
    args_json = _json.dumps({"where": where, "what": what, "order": order, "limit": limit})
    items_json = await _bridge.filter(object_type, args_json)
    await _ensure_gramps()
    from gramps.gen.lib.json_utils import DataDict

    return [DataDict(item) for item in _json.loads(items_json)]


def _set_type_from_string(type_obj, string_value):
    type_obj.set_from_xml_str(string_value)
    if type_obj.is_custom() and string_value not in type_obj._E2IMAP:
        type_obj.set(string_value)


def _get_class_name(super_name, key_name):
    if key_name == "date":
        return "Date"
    if key_name == "media_list":
        return "MediaRef"
    if key_name == "child_ref_list":
        return "ChildRef"
    if key_name == "event_ref_list":
        return "EventRef"
    if key_name == "address_list":
        return "Address"
    if key_name == "urls":
        return "Url"
    if key_name == "lds_ord_list":
        return "LdsOrd"
    if key_name == "person_ref_list":
        return "PersonRef"
    if key_name == "surname_list":
        return "Surname"
    if key_name == "text":
        return "StyledText"
    if key_name == "place_type":
        return "PlaceType"
    if key_name == "alt_loc":
        return "Location"
    if key_name == "reporef_list":
        return "RepoRef"
    if key_name == "placeref_list":
        return "PlaceRef"
    if key_name == "tags":
        return "StyledTextTag"
    if (key_name == "name" and super_name == "Place") or key_name == "alt_names":
        return "PlaceName"
    if key_name in ["primary_name", "alternate_names"]:
        return "Name"
    if key_name == "attribute_list" and (super_name == "Citation" or super_name == "Source"):
        return "SrcAttribute"
    elif key_name == "attribute_list":
        return "Attribute"
    raise ValueError(f"Unknown classes: {super_name}, {key_name}")


def _fix_object_dict(object_dict, class_name=None):
    import gramps.gen.lib
    from gramps.gen.lib.json_utils import object_to_dict

    d_out = {}
    class_name = class_name or object_dict.get("_class")
    if not class_name:
        raise ValueError("No class name specified!")
    d_out["_class"] = class_name
    for k, v in object_dict.items():
        if k in ["type", "place_type", "media_type", "frel", "mrel"] or (
            k == "name" and class_name == "StyledTextTag"
        ):
            if isinstance(v, str):
                if class_name == "Family":
                    _class = "FamilyRelType"
                elif class_name == "RepoRef":
                    _class = "SourceMediaType"
                else:
                    _class = f"{class_name}Type"
                obj = gramps.gen.lib.__dict__[_class]()
                _set_type_from_string(obj, v)
                d_out[k] = object_to_dict(obj)
            else:
                d_out[k] = v
        elif k == "role":
            if isinstance(v, str):
                obj = gramps.gen.lib.__dict__["EventRoleType"]()
                _set_type_from_string(obj, v)
                d_out[k] = object_to_dict(obj)
            else:
                d_out[k] = v
        elif k == "origintype":
            if isinstance(v, str):
                obj = gramps.gen.lib.__dict__["NameOriginType"]()
                _set_type_from_string(obj, v)
                d_out[k] = object_to_dict(obj)
            else:
                d_out[k] = v
        elif k in ["rect", "mother_handle", "father_handle", "famc"] and not v:
            d_out[k] = None
        elif isinstance(v, dict):
            d_out[k] = _fix_object_dict(v, _get_class_name(class_name, k))
        elif isinstance(v, list):
            d_out[k] = [
                _fix_object_dict(item, _get_class_name(class_name, k)) if isinstance(item, dict) else item
                for item in v
            ]
        elif k == "complete":
            pass
        elif k == "date" and v is None:
            d_out[k] = {"_class": "Date", "dateval": [0, 0, 0, False]}
        else:
            d_out[k] = v
    return d_out


async def get_object(object_type, handle):
    """Expensive: a real network round trip plus reconstructing a genuine
    gramps.gen.lib object (installing the minimal wheel on first use).
    Only call this for the specific item(s) you actually need it for --
    never inside a loop over filter() results."""
    import json as _json
    raw_json = await _bridge.getObject(object_type, handle)
    data = _json.loads(raw_json)
    await _ensure_gramps()
    from gramps.gen.lib.json_utils import data_to_object

    return data_to_object(_fix_object_dict(data, object_type.capitalize()))


async def get_raw_object(object_type, handle):
    """Cheaper than get_object(): a full object fetch (still a real network
    round trip -- only call this for the specific item(s) you actually
    need, never inside a loop over filter() results for every match), but
    returned as Gramps's own DataDict instead of an eagerly-reconstructed
    real gramps.gen.lib object. Unlike filter()'s partial, arbitrary-field
    results, this is a genuine whole-object shape, so DataDict's own
    fallback works too: '.attr' for a raw field is free, but reaching for
    a real method or computed attribute (e.g. .get_primary_name()) lazily
    builds the real object on that first access and delegates to it."""
    import json as _json
    raw_json = await _bridge.getObject(object_type, handle)
    data = _json.loads(raw_json)
    await _ensure_gramps()
    from gramps.gen.lib.json_utils import DataDict

    return DataDict(_fix_object_dict(data, object_type.capitalize()))


def _make_object_list_function(object_type):
    """Builds one of the people()/families()/.../tags() convenience
    functions below: filter() to find matching handles (cheap), then
    get_raw_object() each one to get the whole object back as a DataDict.
    Still does one network round trip per matched item (via get_raw_object),
    so 'limit' matters just as much here as it does for filter() itself."""

    async def _list_function(where=None, order=None, limit=50):
        results = await filter(object_type, where=where, order=order, limit=limit)
        return [await get_raw_object(object_type, result["handle"]) for result in results]

    return _list_function


# One convenience function per object type -- filter() + get_raw_object()
# combined, for a Gramplet that wants whole objects without writing that
# loop itself. Still two network round trips per matched item under the
# hood (one from filter(), one per get_raw_object() call), so these are no
# cheaper than doing it by hand -- just less to type.
people = _make_object_list_function("person")
families = _make_object_list_function("family")
events = _make_object_list_function("event")
places = _make_object_list_function("place")
repositories = _make_object_list_function("repository")
sources = _make_object_list_function("source")
citations = _make_object_list_function("citation")
media = _make_object_list_function("media")
notes = _make_object_list_function("note")
tags = _make_object_list_function("tag")


class Db:
    """Named and shaped after Gramps desktop's own \`DbReadBase\`
    (gramps/gen/db/generic.py): \`get_<type>_from_handle(handle)\` wraps
    get_object() (a real gramps.gen.lib object, installing the minimal
    wheel on first use), \`get_raw_<type>_data(handle)\` wraps
    get_raw_object() (a DataDict) -- for each of person/family/event/
    place/repository/source/citation/media/note/tag. Nothing more than
    that: no local cache, no relationship traversal (that's
    SimpleAccess-territory on Gramps desktop, and not cheap even there --
    every access is still a real lookup, just against an already-loaded
    local database this worker doesn't have). A single instance (\`db\`,
    below) is what a Gramplet actually uses."""


def _bind_db_handle_method(object_type):
    async def _get_from_handle(self, handle):
        return await get_object(object_type, handle)

    _get_from_handle.__name__ = f"get_{object_type}_from_handle"
    setattr(Db, _get_from_handle.__name__, _get_from_handle)


def _bind_db_raw_method(object_type):
    async def _get_raw_data(self, handle):
        return await get_raw_object(object_type, handle)

    _get_raw_data.__name__ = f"get_raw_{object_type}_data"
    setattr(Db, _get_raw_data.__name__, _get_raw_data)


for _object_type in (
    "person",
    "family",
    "event",
    "place",
    "repository",
    "source",
    "citation",
    "media",
    "note",
    "tag",
):
    _bind_db_handle_method(_object_type)
    _bind_db_raw_method(_object_type)
del _object_type

db = Db()


# columns()/row(): named and shaped after Gramps desktop's own GrampyScript
# addon (../addons-source/GrampyScript/) -- call columns(...) once (optional)
# and row(...) per row to build a table instead of returning a plain
# string; PyodidePocPanel.tsx/GrampletEditDialog.tsx render it as a real
# GUI table (GrampletResultView.tsx) rather than a Code block whenever any
# rows were appended. Reset before every run (see onmessage below), not
# just once at bootstrap, so a previous run's table can't leak into the
# next one's result.
_gramplet_columns = None
_gramplet_rows = []

def _reset_table():
    global _gramplet_columns, _gramplet_rows
    _gramplet_columns = None
    _gramplet_rows = []

def columns(*names):
    global _gramplet_columns
    _gramplet_columns = [str(n) for n in names]

# Gramps' own gen.datehandler.displayer (locale-aware, calendar-aware,
# ~30 per-locale parser modules) isn't in the minimal wheel (see
# scripts/build-gramps-wheel.py) -- deliberately excluded, it's a lot of
# weight just for a table cell. This is a plain-English subset covering
# the common cases (a single date, before/after/about, range/span, a
# year-only date), not full Gramps date-display fidelity: modifier/
# quality constants copied from gramps.gen.lib.date.Date (MOD_BEFORE=1,
# MOD_AFTER=2, MOD_ABOUT=3, MOD_RANGE=4, MOD_SPAN=5, MOD_TEXTONLY=6) since
# that module isn't necessarily loaded (get_object() hasn't been called).
_MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_MODIFIER_PREFIX = {1: "before ", 2: "after ", 3: "about "}

def _format_single_date(day, month, year):
    if not day and not month and not year:
        return ""
    parts = []
    if day:
        parts.append(str(day))
    if month:
        parts.append(_MONTH_NAMES[month] if 1 <= month <= 12 else str(month))
    if year:
        parts.append(str(year))
    return " ".join(parts)

def _format_date(modifier, dateval, text):
    if modifier == 6 or not dateval:  # MOD_TEXTONLY, or no dateval at all
        return text or ""
    start = _format_single_date(*dateval[0:3])
    if modifier in (4, 5) and len(dateval) >= 7:  # MOD_RANGE, MOD_SPAN
        stop = _format_single_date(*dateval[4:7])
        if start and stop:
            return f"{'between' if modifier == 4 else 'from'} {start} {'and' if modifier == 4 else 'to'} {stop}"
    if start:
        return f"{_MODIFIER_PREFIX.get(modifier, '')}{start}"
    return text or ""

def _is_date_dict(value):
    return isinstance(value, dict) and value.get("_class") == "Date"

def _is_date_object(value):
    # type(value).__name__ rather than an isinstance/gramps.gen.lib.Date
    # check -- that class may not even be imported yet (get_object() is
    # lazy), and this is enough to recognize one without forcing it.
    return type(value).__name__ == "Date" and hasattr(value, "dateval")

def _pp(value):
    # Dtype-aware, not just str(value) -- a Date (either the REST/query
    # struct dict a filter() json_path select can return, e.g.
    # what=["birth.date"], or a real gramps.gen.lib.Date from an object
    # get_object() returned) formats as a real date, not a raw dict/repr.
    # GrampyScript's own pp() special-cases many more gramps.gen.lib
    # object types (Person/Event/Family/...); this can grow the same way.
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "; ".join(_pp(v) for v in value)
    if _is_date_dict(value):
        return _format_date(value.get("modifier", 0), value.get("dateval"), value.get("text", ""))
    if _is_date_object(value):
        return _format_date(value.modifier, tuple(value.dateval), value.text)
    return str(value)

def row(*values):
    _gramplet_rows.append([_pp(v) for v in values])

def _table_json():
    import json as _json
    if not _gramplet_rows:
        return "null"
    cols = _gramplet_columns or [f"Column {i + 1}" for i in range(len(_gramplet_rows[0]))]
    return _json.dumps({"columns": cols, "rows": _gramplet_rows})
`;

let bootstrapPromise: Promise<void> | null = null;
function ensureBootstrap(pyodide: PyodideInterface): Promise<void> {
  if (!bootstrapPromise) {
    pyodide.registerJsModule("_gramps_connect_bridge", bridge);
    bootstrapPromise = pyodide.runPythonAsync(BOOTSTRAP_PY);
  }
  return bootstrapPromise;
}

function reply(response: PyodideWorkerResponse): void {
  postMessage(response);
}

self.onmessage = async (event: MessageEvent<PyodideWorkerRequest>) => {
  const { code, token } = event.data;
  currentToken = token;
  try {
    const pyodide = await getPyodide();
    await ensureBootstrap(pyodide);
    await pyodide.runPythonAsync("_reset_table()");
    const result = await pyodide.runPythonAsync(autoAwaitGrampletCode(code));
    // Table wins over the plain result if the code called row() at all --
    // same "crosses as a plain string, not a live PyProxy" reasoning as
    // filter()/get_object() above.
    const tableJson = (await pyodide.runPythonAsync("_table_json()")) as string;
    const table = JSON.parse(tableJson) as { columns: string[]; rows: string[][] } | null;
    if (table) {
      reply({ type: "table", columns: table.columns, rows: table.rows });
    } else {
      // runPythonAsync() returns Python's `None` (a code body that never
      // reaches a trailing expression -- e.g. a `for` loop, whether or
      // not it ever iterated) as JS `undefined`, not the string "None" --
      // found live from `for person in filter(...): row(person)` with
      // zero matches: no rows were ever appended (so `table` above is
      // null too), and String(undefined) is literally the text
      // "undefined", which reads as an error when it just means "this
      // code produced no result or table". Empty string here, rendered
      // as a friendlier message by GrampletResultView.tsx.
      reply({ type: "result", text: result === undefined ? "" : String(result) });
    }
  } catch (err) {
    reply({ type: "error", text: err instanceof Error ? err.message : String(err) });
  }
};
