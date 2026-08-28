// Throwaway proof-of-concept: can a Pyodide (CPython-in-WASM) worker run
// Python snippets against Gramps data with no DOM/network access of its
// own, only whatever the main thread hands it? See the "app store for
// Gramps Connect addons" conversation this came out of. Gramplets
// themselves are real tree data (grampletMedia.ts), created via MenuBar's
// "Add Gramplet…" or PyodidePocPanel's own "Create new Gramplet" -- no
// more hardcoded seed list. Everything under src/pyodidePoc/ is meant to
// be easy to find and delete once the question is answered.
//
// A Gramplet's Python code decides at runtime what data it needs, via
// several async builtins pyodideWorker.ts installs before running it:
//   - `filter(object_type, where=None, what=None, order=None, limit=50)` --
//     calls gramps-web-api's existing fast `/query/` endpoint directly
//     from the worker (its own fetch(), no round trip through the main
//     thread) and returns each result as Gramps's own `DataDict`
//     (`gramps.gen.lib.json_utils`) of just the requested fields --
//     cheap, this is the same structured-query machinery ViewStore/
//     DataTable already use, just installing the minimal gramps wheel on
//     first use (if not already) to make `DataDict` importable -- no real
//     object reconstruction happens here.
//   - `get_object(object_type, handle)` -- a full object fetch,
//     reconstructed into a real `gramps.gen.lib` object (installing the
//     minimal wheel on first use). Deliberately a separate, explicitly
//     named call: expensive (a real network round trip plus object
//     reconstruction), and a Gramplet has to ask for it on purpose rather
//     than get it by default just from iterating people.
//   - `get_raw_object(object_type, handle)` -- also a full object fetch
//     (same network cost as `get_object`), but returned as a `DataDict`
//     instead of an eagerly-reconstructed real object. Since (unlike
//     `filter`'s partial results) this is a genuine whole-object shape,
//     `DataDict`'s own fallback works too: a raw field is `.attr`-
//     accessible for free, but reaching for a real method or computed
//     attribute (e.g. `.get_primary_name()`) lazily builds the real
//     object on that first access and delegates to it.
//   - `people`/`families`/`events`/`places`/`repositories`/`sources`/
//     `citations`/`media`/`notes`/`tags` -- one convenience function per
//     object type, each `filter(object_type, where, order, limit)` then
//     `get_raw_object()` on every match, e.g.:
//       `for person in people("gender == 1"): print(person.primary_name.first_name)`
//     Still one network round trip per matched item under the hood (via
//     `get_raw_object`), so `limit` matters here exactly as it does for
//     `filter` itself -- no cheaper than doing the loop by hand, just
//     less to type.
//   - `db` -- a single instance of pyodideWorker.ts's `Db` class, named
//     and shaped after Gramps desktop's own `DbReadBase`
//     (gramps/gen/db/generic.py): `db.get_person_from_handle(handle)`
//     wraps `get_object("person", handle)`, `db.get_raw_person_data(handle)`
//     wraps `get_raw_object("person", handle)` -- and likewise for all 10
//     object types. Purely a familiar-naming convenience over the same
//     two calls above; no local cache, no relationship traversal (that's
//     not cheap even on Gramps desktop's own `SimpleAccess` -- it's just
//     that desktop's `DbReadBase` is already a fully-loaded local
//     database, so its lookups are free in a way this worker's network
//     fetches never can be).
//
// `DataDict` (and its list counterpart `DataList`) is Gramps's own dict
// subclass (`gramps.gen.lib.json_utils`) that adds `.attr` access --
// recursively, for nested dicts/lists too -- on top of plain `[]`
// access, which still works exactly as it always has.
//
// Two more (synchronous) builtins -- `columns(*names)`/`row(*values)`,
// named and shaped after Gramps desktop's own GrampyScript addon -- let a
// Gramplet build a table instead of a plain string: call `columns(...)`
// once (optional -- if skipped, columns are auto-named "Column 1", "Column
// 2", ...) and `row(...)` per row, and the result renders as a real GUI
// table (GrampletResultView.tsx) instead of a Code block, if any rows were
// ever appended -- see pyodideWorker.ts's `_table_json()`. A `row()`
// argument can be a primary object itself (whatever `get_object()`/
// `get_raw_object()`/`filter()` handed back) rather than a hand-picked
// field -- e.g. `row(person, event)` -- and renders as clickable link text
// (a default description, ported from Gramps desktop's own
// SimpleAccess.describe()) with a popup to open that record or place it on
// the Map/Timeline/Tree, exactly like the app's own reference panels do.
// See `ObjectCell` below and pyodideWorker.ts's `_describe_object`/`_cell`.
//
// A Gramplet author never has to write `await` before any of the async
// builtins above, despite all being real async functions -- pyodideWorker.ts
// runs every Gramplet's code through autoAwait.ts first, which inserts it
// automatically wherever it's missing (and leaves it alone wherever it's
// already there, so writing it by hand still works fine too).

/** One tab in the panel -- named "Gramplet" after Gramps desktop's own
 * sidebar-widget addons, since that's the closest existing concept this
 * is prototyping a web/Python equivalent of. */
export interface Gramplet {
  id: string;
  label: string;
  /** Python source run in the worker via runPythonAsync (so it can
   * `await filter(...)`/`await get_object(...)`) -- see this file's
   * top comment. */
  code: string;
  /** Object-type view keys (objectEndpoints.ts's OBJECT_QUERY_ENDPOINTS)
   * this Gramplet declares it can run on -- edited via a checkbox group in
   * GrampletEditDialog. Normalized to "every type" by
   * grampletMedia.ts's fetchGramplets() when missing, so a manifest saved
   * before this field existed (the 3 seed examples) keeps behaving exactly
   * as it already did rather than suddenly becoming unselectable anywhere. */
  views?: string[];
  /** Subset of `views` this Gramplet is currently shown as a tab on --
   * toggled per-list via the (+)/(-) glyphs in PyodidePocPanel.tsx, not
   * the full edit dialog. Same "missing means every type" normalization
   * as `views`. */
  addedViews?: string[];
  /** The underlying "Gramplet"-tagged Media object's handle -- NOT part of
   * the stored JSON manifest itself (undefined for a brand new, not-yet-
   * uploaded Gramplet); attached by grampletMedia.ts's fetchGramplets()/
   * fetchGrampletManifest() after fetching, so a caller (PyodidePocPanel's
   * addedViews toggles) knows which Media object to PUT back to.
   * saveGrampletManifest() strips it back out before writing. */
  handle?: string;
}

export interface RunGrampletRequest {
  type: "run-gramplet";
  code: string;
  /** Read by the main thread (getToken()) before posting -- the worker
   * can't call getToken() itself, since that reads localStorage, not
   * available inside a Worker. Known PoC limitation: this is a snapshot,
   * not refreshed mid-run, so a Gramplet running longer than the token's
   * lifetime would start failing its own filter()/get_object() calls. */
  token: string;
}

export type PyodideWorkerRequest = RunGrampletRequest;

/** A `row()` argument that pyodideWorker.ts recognized as a primary Gramps
 * object (a real `gramps.gen.lib` object, or its raw JSON/DataDict form --
 * anything with a `_class` in objectEndpoints.ts's OBJECT_TYPES) renders as
 * this instead of a plain string -- `text` is a default description (ported
 * from Gramps desktop's own SimpleAccess.describe(), see pyodideWorker.ts's
 * `_describe_object`), `objectType`/`handle` are what ObjectCellButton.tsx
 * needs to build a navigation link via hash.ts's formatHash(). */
export interface ObjectCell {
  kind: "object";
  objectType: string;
  handle: string;
  text: string;
}

export type TableCell = string | ObjectCell;

/** Every variant carries `printed` -- whatever the code's own print() calls
 * wrote to stdout during this run (pyodideWorker.ts's `stdout` callback,
 * captured into a buffer reset right before the code runs and joined with
 * "\n" once it's done), independent of the table/result/error outcome
 * below. On `error` too, so print() calls made before a mid-run exception
 * still show -- often the most useful debugging output of all. */
export type PyodideWorkerResponse =
  | { type: "result"; text: string; printed: string }
  | { type: "table"; columns: string[]; rows: TableCell[][]; printed: string }
  /** From calling html(markup) -- raw, UNSANITIZED HTML/SVG source (see
   * pyodideWorker.ts's `html()`/`_gramplet_html`). GrampletResultView.tsx
   * runs it through DOMPurify before ever touching the DOM -- Gramplet code
   * is arbitrary Python, and a Gramplet is a Media object that could end up
   * imported/shared from someone else, not just self-authored. Wins over a
   * table the same run also built, same "the most specific thing the code
   * did wins" reasoning row()/table already gets over a plain result. */
  | { type: "html"; markup: string; printed: string }
  | { type: "error"; text: string; printed: string };
