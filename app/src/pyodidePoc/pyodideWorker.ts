// See types.ts for what this PoC is for. Module worker (loaded via
// `new Worker(new URL(...), { type: "module" })` in PyodidePocPanel.tsx) so
// it can `import "pyodide"` directly -- Vite bundles the loader, while the
// actual asm/wasm/stdlib data files are fetched at runtime from indexURL
// (public/pyodide/, populated by scripts/copy-wasm.mjs).
import { loadPyodide, type PyodideInterface } from "pyodide";
import { API_BASE } from "../config";
import { autoAwaitGrampletCode } from "./autoAwait";
import { OBJECT_QUERY_ENDPOINTS, objectEndpointBase } from "./objectEndpoints";
import type { GrampletBlock, PyodideWorkerRequest, PyodideWorkerResponse } from "./types";

// Loaded once per worker instance and reused across messages -- the ~14MB
// fetch + WASM instantiation is a several-hundred-ms-to-few-seconds cost
// not worth paying per run.
let pyodidePromise: Promise<PyodideInterface> | null = null;
function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    // No `stdout` option -- a Gramplet's own print() calls are captured by
    // BOOTSTRAP_PY's own redefined print() (see pyodideWorker's BOOTSTRAP_PY
    // below), not this JS-level hook, so they land in call order alongside
    // html()/row() output instead of a separate side channel always shown
    // first regardless of when they were actually printed. Whatever else
    // still writes to real stdout (Pyodide's own bootstrap-time chatter,
    // an uncaught low-level warning, ...) just falls through to the
    // default console.log -- fine for a Gramplet dev tool with nothing
    // else consuming this worker's console.
    pyodidePromise = loadPyodide({ indexURL: "/pyodide/" });
  }
  return pyodidePromise;
}

// Pyodide's own CDN fallback for a package missing from indexURL --
// confirmed live by tracing pyodide.asm.mjs's PackageManager -- only fires
// when its internal IN_NODE check is true. In a real browser (main thread
// or Worker, no difference), that branch unconditionally rethrows the
// local 404 instead, so `pyodide.loadPackagesFromImports()` never reaches
// cdn.jsdelivr.net at all -- a package scripts/copy-wasm.mjs hasn't
// pre-fetched into public/pyodide/ is permanently, deterministically
// unavailable there, not just occasionally flaky. (This is exactly why a
// plain Node test script -- IN_NODE true -- "just works" for a package
// this app's browser build can't actually reach.) What follows is our own
// explicit, environment-independent replacement for that fallback: it
// never depends on Pyodide's internal branching, so it behaves the same
// under Node and in the real Worker.
interface LockPackage {
  file_name: string;
  imports: string[];
  depends: string[];
}
interface LockFile {
  packages: Record<string, LockPackage>;
}

let lockFilePromise: Promise<LockFile> | null = null;
function getLockFile(): Promise<LockFile> {
  if (!lockFilePromise) {
    lockFilePromise = fetch("/pyodide/pyodide-lock.json").then((res) => res.json() as Promise<LockFile>);
  }
  return lockFilePromise;
}

// Regex-scanned, not a real parser -- same documented tradeoff as
// autoAwait.ts's own regex-based scan (see that file). Only catches the
// first name on a comma-separated `import a, b` line, and only top-level
// imports (not ones inside a function body) -- good enough for the
// one-per-line style every Gramplet we've seen uses, and no worse than
// Pyodide's own loadPackagesFromImports(), which has the identical
// static-scan limitation.
function scanTopLevelImports(code: string): string[] {
  const names = new Set<string>();
  const importRe = /^[ \t]*import\s+([A-Za-z_]\w*(?:\.\w+)*)/gm;
  const fromRe = /^[ \t]*from\s+([A-Za-z_]\w*(?:\.\w+)*)\s+import\b/gm;
  for (const re of [importRe, fromRe]) {
    for (const match of code.matchAll(re)) {
      names.add(match[1].split(".")[0]);
    }
  }
  return [...names];
}

function transitivePackageClosure(lock: LockFile, packageNames: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...packageNames];
  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined || seen.has(name)) continue;
    const pkg = lock.packages[name];
    if (!pkg) continue; // not a catalog package (e.g. gramps-gen-lib, or a genuine PyPI-only name) -- nothing more we can do automatically
    seen.add(name);
    stack.push(...pkg.depends);
  }
  return [...seen];
}

// Ensures every catalog package the code's own top-level imports need
// (transitively, via `depends`) is actually loaded, whether that means
// finding it in public/pyodide/ (everything scripts/copy-wasm.mjs
// pre-fetches -- the fast, fully-offline path) or, for anything not
// pre-fetched, fetching it directly from cdn.jsdelivr.net ourselves right
// here instead of relying on Pyodide's own browser-incompatible fallback.
// A genuine network failure at that point is allowed to throw for real
// (not swallowed the way loadPackagesFromImports()'s internal per-package
// handling does) -- surfaces as a clear error instead of a bare
// ModuleNotFoundError several lines into the Gramplet's own code.
async function ensureCatalogPackagesForCode(pyodide: PyodideInterface, code: string): Promise<void> {
  await pyodide.loadPackagesFromImports(code, { messageCallback: () => {} });

  const lock = await getLockFile();
  const importToPackage = new Map<string, string>();
  for (const [name, pkg] of Object.entries(lock.packages)) {
    for (const imp of pkg.imports) importToPackage.set(imp, name);
  }
  const topLevelPackages = scanTopLevelImports(code)
    .map((imp) => importToPackage.get(imp))
    .filter((name): name is string => name !== undefined);

  for (const name of transitivePackageClosure(lock, topLevelPackages)) {
    if (pyodide.loadedPackages[name]) continue;
    // Confirmed live: pyodide.loadPackage()'s own promise resolves (never
    // rejects) even when the package it was asked for fails to download --
    // true for a plain name AND for an explicit URL alike. It only ever
    // reports failure via messageCallback/errorCallback (both suppressed
    // here). So loadedPackages[name] after the call, not a try/catch
    // around it, is the only reliable way to tell whether either attempt
    // actually worked -- and if neither did, this throws itself instead of
    // silently leaving the package missing.
    await pyodide.loadPackage(name, { messageCallback: () => {}, errorCallback: () => {} });
    if (pyodide.loadedPackages[name]) continue;
    const cdnUrl = `https://cdn.jsdelivr.net/pyodide/v${pyodide.version}/full/${lock.packages[name].file_name}`;
    await pyodide.loadPackage(cdnUrl, { messageCallback: () => {}, errorCallback: () => {} });
    if (!pyodide.loadedPackages[name]) {
      throw new Error(`Could not load package '${name}' from public/pyodide/ or from ${cdnUrl}`);
    }
  }
}

// Set fresh from each RunGrampletRequest, read by the bridge functions
// below -- the worker can't call getToken() itself (reads localStorage,
// not available inside a Worker), so the main thread resolves a token and
// hands it over per-message instead. See types.ts's RunGrampletRequest
// doc comment for the known "not refreshed mid-run" limitation.
let currentToken = "";

// The RunGrampletRequest currently executing (see runOne() below) -- read
// by bridge.reportProgress() to tag its own message, the same way currentToken
// above is read by the bridge's network calls. Safe to keep as one shared
// variable rather than threading it through every call: onmessage below
// never runs two requests' Python concurrently, so there's only ever one
// meaningful value for this at a time.
let currentRunId = "";

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
  // Deliberately plain (not async), unlike every other bridge function --
  // BOOTSTRAP_PY's print() calls this synchronously, with no `await`, right
  // after buffering each line, so a live-updating loop (print() then
  // time.sleep()) shows each line as it's printed instead of only once the
  // whole run finishes. This works even though a Worker's own JS thread can
  // genuinely block afterward (Pyodide's time.sleep() uses Atomics.wait, or
  // a busy-wait if SharedArrayBuffer isn't available) because postMessage()
  // hands the message off to the browser's own cross-thread queue at call
  // time -- delivery to the main thread doesn't require this worker to
  // keep running JS afterward, so it still arrives and renders mid-sleep.
  reportProgress(blocksJson: string): void {
    reply({ type: "progress", blocks: JSON.parse(blocksJson) as GrampletBlock[], runId: currentRunId });
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
# _describe_object() below -- and renders as a link, not a repr. html(markup)
# is a second way to add to the result, for raw HTML/SVG instead of a
# table -- see html() below. print() is a third (redefined below, not left
# as the real builtin hooked via pyodide's own stdout option): all three
# accumulate into _gramplet_blocks, one block per table (a run of row()
# calls), per html() call, and per run of consecutive print() calls, in
# call order -- see _flush_table()/_flush_print()/html()/print() below and
# GrampletBlock in types.ts. A Gramplet that only ever calls one of the
# three still gets exactly the single block it always did.
_gramplet_columns = None
_gramplet_rows = []
# One set per column index, of every _cell_kind() seen there across every
# row() call -- how _build_table() names an un-columns()'d column "Person"/
# "Date"/... instead of "Column N" when every value it saw agreed on one
# kind (a None in some rows doesn't break that -- _cell_kind(None) is None
# and contributes nothing to the set).
_gramplet_column_kinds = []
# Appended to by _flush_table()/_flush_print()/html() -- see above. Empty
# means the code never called row(), html(), or print().
_gramplet_blocks = []
# Text from consecutive print() calls, not yet flushed into its own block --
# see print()/_flush_print() below.
_gramplet_print_buffer = []

def _reset_table():
    # Name kept from when this only reset the table (still called that way
    # from onmessage below) -- now the one place every per-run global gets
    # cleared, table or not, so nothing from one run leaks into the next.
    global _gramplet_columns, _gramplet_rows, _gramplet_column_kinds, _gramplet_blocks, _gramplet_print_buffer
    _gramplet_columns = None
    _gramplet_rows = []
    _gramplet_column_kinds = []
    _gramplet_blocks = []
    _gramplet_print_buffer = []

def columns(*names):
    global _gramplet_columns
    # Flushes any print() output buffered since the last row()/html() call
    # into its own block first, so a print() -> columns()/row() sequence
    # keeps the print output's place ahead of the table it precedes instead
    # of folding it into whatever comes next.
    _flush_print()
    _gramplet_columns = [str(n) for n in names]

def html(markup):
    # Adds a block to the result, for raw HTML/SVG -- e.g. an SVG string
    # built by hand, or a chart library's own .render() output (pygal's Pie,
    # say): html(chart.render(is_unicode=True)). Unsanitized here on
    # purpose -- GrampletResultView.tsx runs it through DOMPurify right
    # before it ever touches the DOM, the one place that actually matters
    # for an XSS boundary, rather than trusting a second copy of that logic
    # re-done in Pyodide. Flushes any pending print buffer and/or table
    # first, so html()/row()/print() calls interleaved in any order each
    # keep their own place in the result instead of one silently discarding
    # another.
    # pygal (and other chart libs) default render() to bytes, not str --
    # str(b"...") would give the literal "b'...'" repr instead of the
    # markup, so decode bytes here rather than requiring every Gramplet to
    # remember render(is_unicode=True).
    if isinstance(markup, (bytes, bytearray)):
        markup = markup.decode("utf-8")
    _flush_print()
    _flush_table()
    _gramplet_blocks.append({"type": "html", "markup": str(markup)})

def _matplotlib_figure_from(obj):
    # Never imports matplotlib itself -- only recognizes it if the
    # Gramplet's own code already did (sys.modules lookup), so a Gramplet
    # that never touches matplotlib never pays for loading it just because
    # print() knows how to handle one. Handles both \`print(fig)\` and the
    # bare \`print(plt)\` case (the latter matching the habit of ending a
    # matplotlib script with a trailing \`plt\`, e.g. from JupyterLite/IPython,
    # where it means "the current figure").
    import sys
    plt_mod = sys.modules.get("matplotlib.pyplot")
    if plt_mod is None:
        return None
    if obj is plt_mod:
        return plt_mod.gcf()
    figure_mod = sys.modules.get("matplotlib.figure")
    if figure_mod is not None and isinstance(obj, figure_mod.Figure):
        return obj
    return None

def print(*args, sep=" ", end="\\n", **kwargs):
    # Redefined rather than left as the real builtin captured via pyodide's
    # own stdout option (see getPyodide() below) -- that captures every
    # line written to sys.stdout into one buffer for the whole run, always
    # shown before the run's own html()/row() output no matter when it was
    # actually printed relative to them. Routing print() through the same
    # _gramplet_blocks list as html()/row() instead keeps it in true call
    # order with them. Buffers consecutive calls into one block (like row()
    # does for a table) rather than one block per call, flushed by
    # _flush_print() -- called from columns()/row()/html() when one of
    # those interrupts a run of prints, and from _finalize_blocks() at the
    # run's end. Swallows **kwargs (file=, flush=, ...) -- none of them
    # mean anything without a real stdout stream to honor them.
    if len(args) == 1:
        fig = _matplotlib_figure_from(args[0])
        if fig is not None:
            # html() itself calls _flush_print()/_flush_table(), so any
            # print() output queued before this call keeps its place ahead
            # of the image rather than being reordered.
            import io, base64, sys
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight")
            sys.modules["matplotlib.pyplot"].close(fig)
            html(f'<img src="data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}">')
            return
    _flush_table()
    _gramplet_print_buffer.append(sep.join(str(a) for a in args) + end)
    # Pushes what the result would look like right now (not yet flushed
    # into _gramplet_blocks -- see _report_progress() below) back to the
    # main thread immediately, so a print()-then-time.sleep() loop shows
    # each line as it's printed instead of only once the whole run
    # finishes and _finalize_blocks() is called.
    _report_progress()

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
    # column mixing kinds) has no opinion, so _build_table() falls back to
    # "Column N" for it exactly as before.
    if _is_primary_dict(value):
        return value.get("_class")
    if _is_primary_object(value):
        return type(value).__name__
    if _is_date_dict(value) or _is_date_object(value) or _is_stdlib_datetime(value):
        return "Date"
    return None

def row(*values):
    # Flushes any print() output buffered since the last flush into its
    # own block first -- same reasoning as columns() above, since a
    # Gramplet can call row() straight off without ever calling columns().
    _flush_print()
    for i, v in enumerate(values):
        if i >= len(_gramplet_column_kinds):
            _gramplet_column_kinds.append(set())
        kind = _cell_kind(v)
        if kind:
            _gramplet_column_kinds[i].add(kind)
    _gramplet_rows.append([_cell(v) for v in values])

def _build_table():
    if _gramplet_columns:
        cols = _gramplet_columns
    else:
        cols = []
        for i in range(len(_gramplet_rows[0])):
            kinds = _gramplet_column_kinds[i] if i < len(_gramplet_column_kinds) else set()
            cols.append(next(iter(kinds)) if len(kinds) == 1 else f"Column {i + 1}")
    return {"columns": cols, "rows": _gramplet_rows}

def _flush_table():
    # Turns whatever row()/columns() have built up since the last flush
    # into a table block and clears them, so a later html() call (or the
    # run ending, via _finalize_blocks()) starts a fresh table instead of
    # folding more rows into one already emitted. No-op if row() wasn't
    # called since the last flush.
    global _gramplet_columns, _gramplet_rows, _gramplet_column_kinds
    if not _gramplet_rows:
        return
    table = _build_table()
    _gramplet_blocks.append({"type": "table", "columns": table["columns"], "rows": table["rows"]})
    _gramplet_columns = None
    _gramplet_rows = []
    _gramplet_column_kinds = []

def _print_buffer_block():
    # The print buffer's contents (see print() above), as the same
    # escaped/<pre>-wrapped html block shape _flush_print()/_report_
    # progress() below each append -- factored out since both need it,
    # one destructively (clearing the buffer) and one not.
    import html as _html_stdlib
    text = "".join(_gramplet_print_buffer)
    return {"type": "html", "markup": f"<pre>{_html_stdlib.escape(text)}</pre>"}

def _flush_print():
    # Turns whatever print() calls have built up since the last flush into
    # one block and clears the buffer -- see print() above. Sanitized by
    # DOMPurify same as any other html block (GrampletResultView.tsx)
    # rather than needing a whole separate "this one is plain text" block
    # kind. No-op if print() wasn't called since the last flush.
    global _gramplet_print_buffer
    if not _gramplet_print_buffer:
        return
    _gramplet_blocks.append(_print_buffer_block())
    _gramplet_print_buffer = []

def _report_progress():
    # Sends what _finalize_blocks() would return right now -- every block
    # already flushed, plus the print buffer's contents so far as one more
    # (without actually flushing it, so a later print() call still keeps
    # accumulating into the same block rather than starting a new one each
    # time) -- back to the main thread as a {type: "progress"} message, so
    # a print()-then-time.sleep() loop's output shows up live instead of
    # only once the whole run finishes. See print()'s own call to this and
    # bridge.reportProgress()/pyodideWorker.ts's onmessage for the JS side.
    import json as _json
    blocks = list(_gramplet_blocks)
    if _gramplet_print_buffer:
        blocks.append(_print_buffer_block())
    _bridge.reportProgress(_json.dumps(blocks))

def _finalize_blocks():
    # Called once from onmessage after the code has finished running --
    # flushes any print buffer and/or table still pending (the common
    # cases: a Gramplet that calls print() and/or row() and never flushes
    # mid-run by also calling html()) and hands back every block the run
    # produced, in call order.
    import json as _json
    _flush_print()
    _flush_table()
    return _json.dumps(_gramplet_blocks)
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

// For the code's own trailing expression value -- see onmessage below.
// No DOM available in a worker to lean on for this (no `document` to build
// a text node and read back its escaped innerHTML), and this only ever
// feeds a `<pre>...</pre>` text node's contents (see _flush_print()'s own
// html.escape() call in BOOTSTRAP_PY, which this mirrors), so this doesn't
// need to also escape quotes the way an attribute value would.
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Queue of (at most) one -- see self.onmessage below. A newer request
// replaces whatever was queued, never appends: switching tabs three times
// while the first is still running should run the first request, then
// (once it's done) skip straight to the third, not visibly run the second
// too on the way there.
let queuedRequest: PyodideWorkerRequest | null = null;
let running = false;

async function runOne(request: PyodideWorkerRequest): Promise<void> {
  const { code, token, runId } = request;
  currentToken = token;
  currentRunId = runId;
  // Sent right as this request is dequeued and actually starts using the
  // interpreter -- the gap between postMessage() and this arriving is how
  // the caller tells "queued behind another Gramplet" apart from
  // "running" (see RunStatus/PyodideWorkerResponse's own doc comments).
  reply({ type: "started", runId });
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
    // uses it runs -- then, for anything that's a real Pyodide catalog
    // package but wasn't pre-fetched into public/pyodide/, fetches it
    // directly from cdn.jsdelivr.net (see ensureCatalogPackagesForCode's
    // own comment for why this can't just be left to Pyodide's own
    // fallback). messageCallback suppressed the same way getGramps()'s own
    // pyodide.loadPackage("micropip", ...) call is: this is a separate
    // JS-side progress callback, not routed through Python's sys.stdout
    // (and so not something BOOTSTRAP_PY's redefined print() ever sees
    // either) -- suppressed purely so it doesn't spam the real browser
    // console for every run.
    await ensureCatalogPackagesForCode(pyodide, code);
    await pyodide.runPythonAsync("_reset_table()");
    const result = await pyodide.runPythonAsync(autoAwaitGrampletCode(code));
    // _finalize_blocks() flushes any pending print buffer and/or table
    // (see pyodideWorker's BOOTSTRAP_PY) and hands back every block the
    // run produced -- one per table, per html() call, and per run of
    // consecutive print() calls, all in call order.
    const blocksJson = (await pyodide.runPythonAsync("_finalize_blocks()")) as string;
    const blocks = JSON.parse(blocksJson) as GrampletBlock[];
    // The code's own trailing expression value, if it has one -- appended
    // last (it's always chronologically last: everything above already
    // flushed by the time runPythonAsync resolves) as one more block, the
    // same pre-wrapped/escaped shape print() output gets. runPythonAsync()
    // returns Python's `None` (a code body that never reaches a trailing
    // expression -- e.g. a `for` loop, whether or not it ever iterated) as
    // JS `undefined`, not the string "None" -- found live from `for person
    // in filter(...): row(person)` with zero matches: nothing was ever
    // appended, so this is skipped and blocks stays whatever _finalize_
    // blocks() returned (empty, here), rendered as a friendlier "no
    // output" message by GrampletResultView.tsx rather than the literal
    // text "undefined".
    if (result !== undefined) {
      blocks.push({ type: "html", markup: `<pre>${escapeHtml(String(result))}</pre>` });
    }
    reply({ type: "blocks", blocks, runId });
  } catch (err) {
    // Whatever the run produced before the crash -- often the most useful
    // part of a traceback-only failure, so it isn't dropped on the error
    // path. Best-effort: pyodide/BOOTSTRAP_PY may not have finished
    // loading yet if the crash happened that early, in which case there's
    // nothing to recover.
    let blocks: GrampletBlock[] = [];
    try {
      const pyodide = await getPyodide();
      const blocksJson = (await pyodide.runPythonAsync("_finalize_blocks()")) as string;
      blocks = JSON.parse(blocksJson) as GrampletBlock[];
    } catch {
      // Nothing to recover -- fall through with the empty blocks default.
    }
    reply({ type: "error", text: err instanceof Error ? err.message : String(err), blocks, runId });
  }
}

self.onmessage = (event: MessageEvent<PyodideWorkerRequest>) => {
  // Replaces (never appends to) whatever was queued -- see queuedRequest's
  // own doc comment above.
  queuedRequest = event.data;
  if (running) {
    // A Gramplet is already executing Python in this worker -- its own
    // globals (_gramplet_blocks and friends, all module-level in
    // BOOTSTRAP_PY, not per-run) would be corrupted by a second one
    // running concurrently, so this new request just waits in
    // queuedRequest; the loop below picks it up once the current one ends.
    // It can't be cancelled early either -- once Python's actually
    // running (e.g. mid time.sleep()), there's no clean way to interrupt
    // it from here.
    return;
  }
  running = true;
  (async () => {
    // queuedRequest may itself be replaced again *while* runOne() below is
    // still awaiting (a third tab switch before the first request even
    // starts) -- re-reading it fresh each iteration, rather than capturing
    // one value up front, is what makes that "always run the latest, skip
    // whatever was superseded in between" behavior work.
    while (queuedRequest) {
      const request = queuedRequest;
      queuedRequest = null;
      await runOne(request);
    }
    running = false;
  })();
};
