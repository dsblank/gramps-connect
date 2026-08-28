// See types.ts for what this PoC is for. Module worker (loaded via
// `new Worker(new URL(...), { type: "module" })` in PyodidePocPanel.tsx) so
// it can `import "pyodide"` directly -- Vite bundles the loader, while the
// actual asm/wasm/stdlib data files are fetched at runtime from indexURL
// (public/pyodide/, populated by scripts/copy-wasm.mjs).
import { loadPyodide, type PyodideInterface } from "pyodide";
import { API_BASE } from "../config";
import { autoAwaitGrampletCode } from "./autoAwait";
import { OBJECT_QUERY_ENDPOINTS, objectEndpointBase } from "./objectEndpoints";
import type { PyodideWorkerRequest, PyodideWorkerResponse, TableCell } from "./types";

// Loaded once per worker instance and reused across messages -- the ~14MB
// fetch + WASM instantiation is a several-hundred-ms-to-few-seconds cost
// not worth paying per run.
let pyodidePromise: Promise<PyodideInterface> | null = null;
function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({ indexURL: "/pyodide/", stdout: (msg) => printedLines.push(msg) });
  }
  return pyodidePromise;
}

// A Gramplet's own print() calls -- pyodide's `stdout` option above is
// called once per line written to sys.stdout, for the lifetime of this
// worker (loadPyodide() runs once, see pyodidePromise). Reset right before
// each run (onmessage below), not once at load, so bootstrap-time chatter
// (module imports, the gramps wheel install, ...) never leaks into a run's
// own output, and this run's lines don't leak into the next one's.
let printedLines: string[] = [];

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
// gramps-web-api's /query/ endpoint caps a single request's `limit` at
// 1000 (object_query.py: validate.Range(min=1, max=1000)) -- confirmed
// live, a bare limit=1000+ request is rejected outright, not clamped.
// bridge.filter() below pages transparently past that itself, so a
// Gramplet's own filter(..., limit=5000) just works rather than erroring.
const MAX_PAGE_LIMIT = 1000;

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
    // Keyset pagination (gramps-web-api's `after`, echoing its own
    // `next_after` back on the following request) rather than an offset --
    // `where_expr`/`order_by`/`select` stay identical across every page
    // below, which is what keeps the cursor well-defined; only `limit`/
    // `after` change per request. `next_after` is a handle, or null on the
    // last page (object_query.py: `next_after = ... if has_more else None`).
    const items: unknown[] = [];
    let after: string | undefined;
    while (items.length < args.limit) {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify({
          select,
          where_expr: args.where ?? undefined,
          order_by: args.order ?? undefined,
          limit: Math.min(args.limit - items.length, MAX_PAGE_LIMIT),
          after,
        }),
      });
      if (!res.ok) throw new Error(`filter(): ${res.status} ${await res.text()}`);
      const page = (await res.json()) as { items: unknown[]; next_after: string | null };
      items.push(...page.items);
      if (!page.next_after) break;
      after = page.next_after;
    }
    return JSON.stringify(items);
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
  // get_number_of_<type>()'s bridge half -- limit=1 (only one row's worth
  // of deserialize/privacy-sanitize work, same as filter()'s own per-page
  // cost) plus count=true, whose match total comes back in the
  // X-Total-Count response header rather than in the body (object_query.py
  // ~line 869) -- nothing about the matches themselves needs to cross the
  // network for this, just their count.
  async count(objectType: string, argsJson: string): Promise<string> {
    const { where } = JSON.parse(argsJson) as { where: string | null };
    const endpoint = OBJECT_QUERY_ENDPOINTS[objectType];
    if (!endpoint) throw new Error(`count(): unknown object type ${JSON.stringify(objectType)}`);
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
      body: JSON.stringify({ select: ["handle"], where_expr: where ?? undefined, limit: 1, count: true }),
    });
    if (!res.ok) throw new Error(`count(): ${res.status} ${await res.text()}`);
    const total = res.headers.get("X-Total-Count");
    if (total === null) throw new Error("count(): missing X-Total-Count response header");
    return total;
  },
};

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

async def filter(object_type, where=None, what=None, order=None, limit=50):
    """Cheap: gramps-web-api's existing fast /query/ endpoint, called
    directly from this worker. Returns each result as Gramps's own
    DataDict (gramps.gen.lib.json_utils) -- a plain dict of just the
    requested fields ('what'), with '.attr' access too -- never a real
    gramps.gen.lib object. A 'what' entry may cross one relationship with
    a dotted name (e.g. "birth.date", "father.gramps_id") to reach a
    field on the related record; the response key is that same dotted
    string. 'where' is a where_expr string (e.g. 'gender == 1'), 'order'
    is a list of {"column": ..., "direction": "asc"|"desc"}. 'limit' isn't
    capped at gramps-web-api's own per-request max of 1000 -- pass 5000
    and get 5000 (or every match, if fewer): the JS bridge pages through
    multiple requests transparently, so this never needs to think about
    the server's own per-page limit."""
    import json as _json
    args_json = _json.dumps({"where": where, "what": what, "order": order, "limit": limit})
    items_json = await _bridge.filter(object_type, args_json)
    from gramps.gen.lib.json_utils import DataDict

    return [DataDict(item) for item in _json.loads(items_json)]


async def count(object_type, where=None):
    """Cheap: a single /query/ request with count=true and limit=1 -- the
    match total comes back in the X-Total-Count response header, so
    nothing about the matches themselves (beyond the one row needed to
    prove any exist) crosses the network. 'where' is the same where_expr
    string filter() takes."""
    import json as _json
    args_json = _json.dumps({"where": where})
    total = await _bridge.count(object_type, args_json)
    return int(total)


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
    gramps.gen.lib object. Only call this for the specific item(s) you
    actually need it for -- never inside a loop over filter() results."""
    import json as _json
    raw_json = await _bridge.getObject(object_type, handle)
    data = _json.loads(raw_json)
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
    get_raw_object() (a DataDict), \`iter_<type>_handles()\` wraps filter()
    (just the matching handles), \`iter_<plural>()\` wraps the module-level
    plural (e.g. people()/families()), \`get_<type>_from_gramps_id(id)\`
    wraps filter()+get_object() (Tag has no gramps_id field in
    gramps.gen.lib, so it alone skips this one), and
    \`get_number_of_<plural>()\` wraps count() -- for each of person/family/
    event/place/repository/source/citation/media/note/tag. Unlike DbReadBase's
    real iter_* methods, these take the same where/order/limit as
    filter() and are capped at limit (default 50) rather than always
    walking every row in the tree -- there's no local cache here, every
    call is a real network round trip, so an uncapped iterator would be
    an unbounded number of requests. No relationship traversal either
    (that's SimpleAccess-territory on Gramps desktop, and not cheap even
    there -- every access is still a real lookup, just against an
    already-loaded local database this worker doesn't have). A single
    instance (\`db\`, below) is what a Gramplet actually uses."""


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


def _bind_db_iter_handles_method(object_type):
    async def _iter_handles(self, where=None, order=None, limit=50):
        results = await filter(object_type, where=where, order=order, limit=limit)
        return [result["handle"] for result in results]

    _iter_handles.__name__ = f"iter_{object_type}_handles"
    setattr(Db, _iter_handles.__name__, _iter_handles)


# object_type -> (plural method-name suffix, the module-level plural
# function it aliases) -- can't just read the plural name off the
# function itself (people.__name__ etc. are all "_list_function", the
# one closure _make_object_list_function returns every time) and the
# plural isn't a mechanical "{object_type}s" either (person -> people,
# media stays media). DbReadBase's own names (iter_people, not
# iter_persons) are the reference for the irregular ones.
_ITER_PLURALS = {
    "person": ("people", people),
    "family": ("families", families),
    "event": ("events", events),
    "place": ("places", places),
    "repository": ("repositories", repositories),
    "source": ("sources", sources),
    "citation": ("citations", citations),
    "media": ("media", media),
    "note": ("notes", notes),
    "tag": ("tags", tags),
}


def _bind_db_iter_objects_method(object_type):
    plural_name, plural_fn = _ITER_PLURALS[object_type]

    async def _iter_objects(self, where=None, order=None, limit=50):
        return await plural_fn(where=where, order=order, limit=limit)

    _iter_objects.__name__ = f"iter_{plural_name}"
    setattr(Db, _iter_objects.__name__, _iter_objects)


def _bind_db_gramps_id_method(object_type):
    async def _get_from_gramps_id(self, gramps_id):
        # repr() rather than hand-rolled quoting -- a correctly-escaped
        # Python string literal for whatever gramps_id contains, in the
        # same where_expr grammar filter()'s own 'where' string speaks.
        matches = await filter(object_type, where=f"gramps_id == {gramps_id!r}", limit=1)
        if not matches:
            return None
        return await get_object(object_type, matches[0]["handle"])

    _get_from_gramps_id.__name__ = f"get_{object_type}_from_gramps_id"
    setattr(Db, _get_from_gramps_id.__name__, _get_from_gramps_id)


def _bind_db_count_method(object_type):
    plural_name, _ = _ITER_PLURALS[object_type]

    async def _get_number_of(self):
        return await count(object_type)

    _get_number_of.__name__ = f"get_number_of_{plural_name}"
    setattr(Db, _get_number_of.__name__, _get_number_of)


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
    _bind_db_iter_handles_method(_object_type)
    _bind_db_iter_objects_method(_object_type)
    if _object_type != "tag":  # Tag has no gramps_id field in gramps.gen.lib
        _bind_db_gramps_id_method(_object_type)
    _bind_db_count_method(_object_type)
del _object_type

db = Db()


# columns()/row(): named and shaped after Gramps desktop's own GrampyScript
# addon (../addons-source/GrampyScript/) -- call columns(...) once (optional)
# and row(...) per row to build a table instead of returning a plain
# string; PyodidePocPanel.tsx/GrampletEditDialog.tsx render it as a real
# GUI table (GrampletResultView.tsx) rather than a Code block whenever any
# rows were appended. Reset before every run (see onmessage below), not
# just once at bootstrap, so a previous run's table can't leak into the
# next one's result. A row() argument can be a whole primary object
# (Person/Event/...), not just a hand-picked field -- see _cell()/
# _describe_object() below -- and renders as a link, not a repr. Skipping
# columns() no longer always names a column "Column N" either: if every
# row's value in it was the same recognized kind, that kind names the
# column instead ("Person", "Date", ...) -- see _cell_kind(). html(markup)
# is the third way to switch the result, for raw HTML/SVG instead of a
# table -- see html() below, and onmessage's priority order between the two.
_gramplet_columns = None
_gramplet_rows = []
# One set per column index, of every _cell_kind() seen there across every
# row() call -- how _table_json() names an un-columns()'d column "Person"/
# "Date"/... instead of "Column N" when every value it saw agreed on one
# kind (a None in some rows doesn't break that -- _cell_kind(None) is None
# and contributes nothing to the set).
_gramplet_column_kinds = []
# Set by html(markup) -- see below. None means the code never called it.
_gramplet_html = None

def _reset_table():
    # Name kept from when this only reset the table (still called that way
    # from onmessage below) -- now the one place every per-run global gets
    # cleared, table or not, so nothing from one run leaks into the next.
    global _gramplet_columns, _gramplet_rows, _gramplet_column_kinds, _gramplet_html
    _gramplet_columns = None
    _gramplet_rows = []
    _gramplet_column_kinds = []
    _gramplet_html = None

def columns(*names):
    global _gramplet_columns
    _gramplet_columns = [str(n) for n in names]

def html(markup):
    # Switches the result to raw HTML/SVG -- e.g. an SVG string built by
    # hand, or a chart library's own .render() output (pygal's Pie, say):
    # html(chart.render(is_unicode=True)). Unsanitized here on purpose --
    # GrampletResultView.tsx runs it through DOMPurify right before it ever
    # touches the DOM, the one place that actually matters for an XSS
    # boundary, rather than trusting a second copy of that logic re-done in
    # Pyodide. Wins over a table the same run also built (see onmessage's
    # priority order), same as row() winning over a plain result.
    global _gramplet_html
    _gramplet_html = str(markup)

# No install_packages()-style builtin needed for pygal (or anything else
# scripts/copy-wasm.mjs pre-bundles this way): those are registered as
# real entries in public/pyodide/pyodide-lock.json, the same registry
# Pyodide's own distribution and micropip itself live in, so a Gramplet
# just writes a plain import pygal -- see onmessage below, which calls
# pyodide.loadPackagesFromImports() (Pyodide's own static-import scanner)
# on the code before running it, exactly the mechanism that makes any of
# Pyodide's hundreds of built-in packages "just importable" with no
# explicit load call. Confirmed live: import pygal alone, no prior
# get_object()/filter() call to have warmed anything up first, correctly
# pulls in its full dependency chain (importlib-metadata, zipp) via
# Pyodide's own dependency resolution, no micropip/PyPI round trip at all.

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

def _is_stdlib_datetime(value):
    # A plain Python datetime.date/datetime.datetime -- distinct from
    # gramps.gen.lib.Date above (e.g. datetime.datetime.fromtimestamp(
    # person.change), the usual way to turn a primary object's Unix-epoch
    # "change" field into something row()-able). isinstance rather than
    # the name-check _is_date_object uses -- datetime is always-available
    # stdlib, no lazy gramps wheel install to avoid forcing here.
    import datetime
    return isinstance(value, datetime.date)

def _format_stdlib_datetime(value):
    import datetime
    label = f"{value.day} {_MONTH_NAMES[value.month]} {value.year}"
    if isinstance(value, datetime.datetime):
        label += value.strftime(" %H:%M:%S")
    return label

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
    if _is_stdlib_datetime(value):
        return _format_stdlib_datetime(value)
    return str(value)

# Primary-object cells: a row() argument that's a whole Person/Event/...
# (real gramps.gen.lib object, or its raw JSON/DataDict form -- the same
# two shapes _is_date_dict/_is_date_object tell apart above) renders as a
# link instead of a stringified repr -- see ObjectCell in types.ts and
# ObjectCellButton.tsx, which turns {kind, objectType, handle, text} into
# clickable text with an "Open in <view>" (+ Map/Timeline/Tree) popup.
_PRIMARY_CLASSES = {
    "Person", "Family", "Event", "Place", "Repository",
    "Source", "Citation", "Media", "Note", "Tag",
}

def _is_primary_dict(value):
    return isinstance(value, dict) and value.get("_class") in _PRIMARY_CLASSES

def _is_primary_object(value):
    # Same reasoning as _is_date_object: name-check rather than isinstance,
    # so this doesn't force gramps.gen.lib to be imported just to ask.
    return type(value).__name__ in _PRIMARY_CLASSES and hasattr(value, "handle")

def _field(value, key):
    # Normalizes DataDict/plain-dict access (.get) against real-object
    # access (getattr) -- every helper below reads through this so it
    # works on whichever of the two shapes _cell() handed it.
    return value.get(key) if isinstance(value, dict) else getattr(value, key, None)

def _type_label(value):
    # A GrampsType-valued field (Event.type, Note.type, ...) serializes as
    # {"_class": "EventType", "value": 12, "string": ""} -- "string" is
    # only populated for a *custom* type, so a built-in type (e.g. Birth)
    # needs decoding via the real GrampsType subclass. That class is only
    # importable once the minimal gramps wheel is installed, which by this
    # point it always is: every path that can hand row() a primary
    # dict/object (filter()/get_object()/get_raw_object(), see this file's
    # top doc comment) already installed it to build the DataDict/object
    # in the first place. The real-object form (already a GrampsType
    # instance) just needs str().
    if value is None:
        return ""
    if not isinstance(value, dict):
        return str(value)
    string = value.get("string") or ""
    if string:
        return string
    cls, num = value.get("_class"), value.get("value")
    if cls and num is not None:
        try:
            import gramps.gen.lib as _gen_lib
            type_cls = getattr(_gen_lib, cls, None)
            if type_cls is not None:
                return str(type_cls(num))
        except Exception:
            pass
    return string

def _name_label(name):
    if name is None:
        return ""
    given = _field(name, "first_name") or ""
    surnames = " ".join(
        s for s in (_field(sn, "surname") for sn in (_field(name, "surname_list") or [])) if s
    )
    return f"{given} {surnames}".strip()

def _describe_object(value):
    # Lightweight, dbase-free counterpart to Gramps desktop's
    # gramps.gen.simple.SimpleAccess.describe() (gramps/gen/simple/
    # _simpleaccess.py) -- that one needs a live local DbReadBase for
    # cross-object lookups this sandboxed worker doesn't have, so Family
    # here falls back to just its gramps_id rather than resolving parent
    # names (that'd be two more network round trips).
    cls = value.get("_class") if isinstance(value, dict) else type(value).__name__
    gid = _field(value, "gramps_id")
    suffix = f" [{gid}]" if gid else ""
    if cls == "Person":
        return f"{_name_label(_field(value, 'primary_name')) or 'Person'}{suffix}"
    if cls == "Event":
        return f"{_type_label(_field(value, 'type')) or 'Event'}{suffix}"
    if cls == "Place":
        label = _field(_field(value, "name"), "value")
        return f"{label or 'Place'}{suffix}"
    if cls == "Media":
        return f"{_field(value, 'desc') or 'Media'}{suffix}"
    if cls == "Source":
        return f"{_field(value, 'title') or 'Source'}{suffix}"
    if cls == "Repository":
        return f"{_field(value, 'name') or 'Repository'}{suffix}"
    if cls == "Citation":
        page = _field(value, "page")
        return f"{page}{suffix}" if page else f"Citation{suffix}"
    if cls == "Note":
        raw = _field(_field(value, "text"), "string") or ""
        snippet = raw.strip().replace("\\n", " ")[:40]
        return f"{snippet or 'Note'}{suffix}"
    if cls == "Tag":
        return _field(value, "name") or f"Tag{suffix}"
    if cls == "Family":
        return f"Family{suffix}"
    handle = _field(value, "handle")
    return f"{cls}{suffix or (f' [{str(handle)[:8]}]' if handle else '')}"

def _cell(value):
    if _is_primary_dict(value) or _is_primary_object(value):
        cls = value.get("_class") if isinstance(value, dict) else type(value).__name__
        return {
            "kind": "object",
            "objectType": cls.lower(),
            "handle": _field(value, "handle"),
            "text": _describe_object(value),
        }
    return _pp(value)

def _cell_kind(value):
    # What a default (un-columns()'d) header should call this column, if
    # every row agrees -- the primary object's own _class ("Person",
    # "Family", ...) or "Date"; anything else (plain strings/numbers, or a
    # column mixing kinds) has no opinion, so _table_json() falls back to
    # "Column N" for it exactly as before.
    if _is_primary_dict(value):
        return value.get("_class")
    if _is_primary_object(value):
        return type(value).__name__
    if _is_date_dict(value) or _is_date_object(value) or _is_stdlib_datetime(value):
        return "Date"
    return None

def row(*values):
    for i, v in enumerate(values):
        if i >= len(_gramplet_column_kinds):
            _gramplet_column_kinds.append(set())
        kind = _cell_kind(v)
        if kind:
            _gramplet_column_kinds[i].add(kind)
    _gramplet_rows.append([_cell(v) for v in values])

def _table_json():
    import json as _json
    if not _gramplet_rows:
        return "null"
    if _gramplet_columns:
        cols = _gramplet_columns
    else:
        cols = []
        for i in range(len(_gramplet_rows[0])):
            kinds = _gramplet_column_kinds[i] if i < len(_gramplet_column_kinds) else set()
            cols.append(next(iter(kinds)) if len(kinds) == 1 else f"Column {i + 1}")
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
    // Unconditional, not gated behind the code calling filter()/
    // get_object() first: those internally do `from gramps.gen.lib.
    // json_utils import DataDict`, an import loadPackagesFromImports()
    // below can't see (it only scans the Gramplet's own code text, not
    // BOOTSTRAP_PY's), so this needs its own explicit call regardless of
    // whether the Gramplet's own code ever mentions "gramps" literally --
    // most don't (they just call filter()/get_object()). Loads via
    // Pyodide's own package registry now (public/pyodide/pyodide-lock.
    // json, registered by scripts/copy-wasm.mjs from scripts/
    // build-gramps-wheel.py's output) rather than a bespoke micropip +
    // runtime-stub-injection dance -- gi/orjson (its own `depends`) come
    // along automatically the same way any package's dependencies do.
    // Cheap after the first call regardless: loadPackage() is idempotent
    // for an already-installed package, confirmed live.
    await pyodide.loadPackage("gramps-gen-lib", { messageCallback: () => {} });
    // Scans the code's own `import` statements against Pyodide's package
    // registry (public/pyodide/pyodide-lock.json, extended by
    // scripts/copy-wasm.mjs -- see BOOTSTRAP_PY's own comment on this) and
    // pre-loads anything found, e.g. `import pygal`, before the code that
    // uses it runs. messageCallback suppressed for the same reason
    // getGramps()'s own pyodide.loadPackage("micropip", ...) call is: its
    // default "Loading X"/"Loaded X" progress otherwise routes through
    // this run's own captured stdout (see printedLines above) and would
    // show up in the Gramplet's own output.
    await pyodide.loadPackagesFromImports(code, { messageCallback: () => {} });
    await pyodide.runPythonAsync("_reset_table()");
    printedLines = [];
    const result = await pyodide.runPythonAsync(autoAwaitGrampletCode(code));
    const printed = printedLines.join("\n");
    // html() wins over everything -- checked first, same "crosses as a
    // plain string" reasoning as filter()/get_object() above (a bare
    // global reference as the trailing expression needs no _table_json()-
    // style JSON wrapper the way a list-of-dicts table does).
    const htmlMarkup = (await pyodide.runPythonAsync("_gramplet_html")) as string | undefined;
    // Table wins over the plain result if the code called row() at all --
    // same "crosses as a plain string, not a live PyProxy" reasoning as
    // filter()/get_object() above.
    const tableJson = (await pyodide.runPythonAsync("_table_json()")) as string;
    const table = JSON.parse(tableJson) as { columns: string[]; rows: TableCell[][] } | null;
    if (htmlMarkup) {
      reply({ type: "html", markup: htmlMarkup, printed });
    } else if (table) {
      reply({ type: "table", columns: table.columns, rows: table.rows, printed });
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
      reply({ type: "result", text: result === undefined ? "" : String(result), printed });
    }
  } catch (err) {
    reply({
      type: "error",
      text: err instanceof Error ? err.message : String(err),
      // Whatever printed before the crash -- often the most useful part
      // of a traceback-only failure, so it isn't dropped on the error path.
      printed: printedLines.join("\n"),
    });
  }
};
