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
// ever appended -- see pyodideWorker.ts's `_build_table()`. A `row()`
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
  /** Short name, shown as the Gramplet's own tab label in
   * PyodidePocPanel.tsx (and mirrored into the underlying Media object's
   * `desc`, so it's what identifies it in the Media list too). Enforced
   * unique across the tree by GrampletEditDialog.tsx. Kept short on
   * purpose -- a tab has very little room; what the Gramplet actually
   * *does* belongs in `description` below. */
  label: string;
  /** A sentence saying what this Gramplet shows -- what the "+ Add
   * Gramplet" menu (PyodidePocPanel.tsx) shows under each name, so
   * someone picking one to add has more to go on than a two-word tab
   * label. Optional (undefined for anything saved before this field
   * existed, and for an author who just doesn't write one) -- the menu
   * simply shows the name alone in that case. Never used as the tab
   * label itself. */
  description?: string;
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
  /** Whether this Gramplet should automatically re-run when the *selected*
   * record on whichever view it's currently a tab of changes (a different
   * row clicked, or arriving via a link) -- off (undefined/false) by
   * default, since most Gramplets are tree-wide summaries with no reason
   * to care what's selected. Edited via a toggle in GrampletEditDialog,
   * next to `views`. Read by PyodidePocPanel.tsx (only for the active
   * tab -- a backgrounded listening Gramplet just picks up the latest
   * selection next time it's reactivated, same as every other rerun
   * trigger here). See RunGrampletRequest's own selectedType/
   * selectedHandle for what a listening Gramplet's code actually reads. */
  listensToSelection?: boolean;
  /** Whether this Gramplet should automatically re-run when the *filter*
   * currently applied on whichever view it's a tab of changes (FilterBar's
   * own `apply()`/`clearFilter()`, see ViewStore's `whereExpr`) -- off
   * (undefined/false) by default, same reasoning as `listensToSelection`
   * just above: most Gramplets don't care what's filtered in the list
   * they happen to be a tab on. Edited via a toggle in GrampletEditDialog,
   * right next to `listensToSelection`. Read by PyodidePocPanel.tsx (only
   * for the active tab, same as `listensToSelection`). See
   * RunGrampletRequest's own `whereExpr` for what a listening Gramplet's
   * code actually reads (via `get_filter()`). */
  listensToFilter?: boolean;
  /** The catalog entry's own `id` (CatalogEntry.id below) this Gramplet was
   * installed from, if it was installed from the Gramplet Store rather
   * than hand-authored via "Create new Gramplet" -- undefined for the
   * latter. Written once by grampletStore.ts's installFromCatalog() and
   * never touched again by ordinary code-edit saves
   * (saveGrampletManifest() passes whatever `sourceId` the caller's
   * in-memory Gramplet already has straight through), so it stays
   * accurate even after a viewer customizes the installed copy's code.
   * Unlike `handle`, this IS part of the stored manifest -- it travels
   * with the tree/XML export, same as the rest of the Gramplet. */
  sourceId?: string;
  /** The catalog entry's `version` string at the moment this Gramplet was
   * last installed or updated from it -- compared against the *current*
   * catalog entry's own `version` (grampletStore.ts's `hasCatalogUpdate()`)
   * to decide whether to show "Update available". Meaningless without
   * `sourceId`; always set together with it. */
  sourceVersion?: string;
  /** A cheap, non-cryptographic checksum (grampletStore.ts's `hashCode()`)
   * of `code` as it stood immediately after the last install/update from
   * the catalog -- compared against a fresh hash of the *current* `code`
   * (grampletStore.ts's `wasEditedSinceInstall()`) to tell whether a
   * viewer has hand-edited an installed Gramplet since, so Update can warn
   * before silently overwriting their changes rather than assuming an
   * installed copy is always still pristine. Meaningless without
   * `sourceId`. */
  sourceCodeHash?: string;
  /** The underlying "Gramplet"-tagged Media object's handle -- NOT part of
   * the stored JSON manifest itself (undefined for a brand new, not-yet-
   * uploaded Gramplet); attached by grampletMedia.ts's fetchGramplets()/
   * fetchGrampletManifest() after fetching, so a caller (PyodidePocPanel's
   * addedViews toggles) knows which Media object to PUT back to.
   * saveGrampletManifest() strips it back out before writing. */
  handle?: string;
}

/** One entry in the Gramplet Store's catalog (gramplet-store/catalog.json,
 * built by app/scripts/build-gramplet-catalog.mjs from gramplet-store/
 * <id>/manifest.json + code.py -- see that directory's own README for the
 * source format) -- fetched by grampletStore.ts's fetchCatalog() over
 * plain, unauthenticated fetch() (public static content, unlike every
 * other request this app makes). Shaped closely after `Gramplet` above
 * (`installFromCatalog()` builds one directly from an entry: `name` ->
 * `label`, `code`/`description`/`views`/`listensToSelection`/
 * `listensToFilter` carried straight through) but a distinct type -- a
 * catalog entry is never itself a tree object, and carries a few fields
 * (`version`, `author`, `category`, `iconUrl`) a Gramplet manifest has no
 * use for. */
export interface CatalogEntry {
  /** Stable across versions -- becomes an installed Gramplet's own
   * `sourceId`. Must match the catalog's own gramplet-store/<id>/ folder
   * name (enforced at build time by build-gramplet-catalog.mjs). */
  id: string;
  /** Becomes an installed Gramplet's `label`. */
  name: string;
  description: string;
  /** Plain semver, e.g. "1.0.0" -- compared against an installed
   * Gramplet's own `sourceVersion` to decide whether an update is
   * available (grampletStore.ts's `hasCatalogUpdate()`). */
  version: string;
  author: string;
  /** A short grouping tag ("example", "detail", "utility", "chart", ...)
   * -- free text, not a closed enum; the Store UI groups/filters by
   * whatever values actually show up in the catalog. */
  category: string;
  /** Same shape and meaning as `Gramplet.views` -- omitted means "every
   * object type". */
  views?: string[];
  listensToSelection?: boolean;
  listensToFilter?: boolean;
  /** Relative to the catalog's own base URL (e.g. "icons/hello-table.png"),
   * not an absolute URL -- resolved against `fetchCatalog()`'s own
   * `catalogUrl` by whichever component renders it. Undefined when the
   * entry has no icon. */
  iconUrl?: string;
  /** The Gramplet's Python source -- becomes an installed Gramplet's own
   * `code` verbatim. */
  code: string;
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
  /** Generated fresh by the caller (PyodidePocPanel.tsx/GrampletEditDialog.
   * tsx) for every request, e.g. a switched-to tab's own run -- echoed back
   * on every PyodideWorkerResponse for this run (see below) so the caller
   * can tell a stale run's messages apart from the current one's and
   * ignore them, and so pyodideWorker.ts can serialize execution (one
   * Gramplet actually running Python at a time in the shared worker/
   * interpreter -- BOOTSTRAP_PY's globals aren't per-run, so two running
   * concurrently would corrupt each other's row()/print()/html() output)
   * without silently dropping a request made while a previous one (e.g. a
   * `time.sleep()` loop) was still in flight -- it just queues, replacing
   * any earlier still-queued request, and runs once the current one ends. */
  runId: string;
  /** The Gramplet's own stable id (Gramplet.id above), unlike `runId` which
   * changes every request -- not consumed yet (this PoC's st.button() only
   * needs `widgetEvent` below), but both call sites already have it at
   * hand, and a later widget needing state to persist across separate
   * reruns (a counter, a typed-in string) will key its store by this. */
  grampletId: string;
  /** Set only when this run was triggered by a click on a previously
   * rendered `st.*` widget (see GrampletResultView.tsx's delegated
   * click listener) rather than a fresh Execute/tab-switch run -- `key`
   * matches the `data-gramplet-key` the widget rendered itself with.
   * pyodideWorker.ts's runOne() feeds this into `_st_event_key`/
   * `_st_event_value` before running the code, so e.g. st.button() can
   * tell "was I the one just clicked" apart from every other run. */
  widgetEvent?: { key: string; value: unknown };
  /** The type ("person", "family", ...) and handle of whichever record is
   * currently selected on the view this Gramplet is running under (see
   * ViewStore's own `selectedHandle`, the same value that drives the
   * app's own Related Panel) -- null/null when nothing is selected yet
   * (e.g. an empty list) or when there's no view context at all (the
   * standalone Gramplet editor's own preview run, see
   * GrampletEditDialog.tsx). Required (not optional) so every call site
   * has to decide explicitly rather than leaving it undefined by
   * accident. Read by the Gramplet's own `get_selected()` (see
   * pyodideWorker.ts's BOOTSTRAP_PY) on every run -- whether or not the
   * Gramplet actually asked to be *re-run* when selection changes
   * (Gramplet.listensToSelection): a non-listening Gramplet still sees
   * whatever was selected at the time it ran for some other reason. */
  selectedType: string | null;
  selectedHandle: string | null;
  /** The where_expr string currently applied on the view this Gramplet is
   * running under (ViewStore's own `whereExpr`, same value FilterBar.tsx
   * reads/writes), or null when no filter is active or when there's no
   * view context at all (the standalone editor's own preview run, same
   * as selectedType/selectedHandle above). Read by the Gramplet's own
   * `get_filter()` (see pyodideWorker.ts's BOOTSTRAP_PY) on every run --
   * whether or not the Gramplet asked to be *re-run* when the filter
   * changes (Gramplet.listensToFilter): a non-listening Gramplet still
   * sees whatever filter was applied at the time it ran for some other
   * reason, same as selectedType/selectedHandle. */
  whereExpr: string | null;
  /** The handle of the user's Home person, read from
   * store/homePersonPreference.ts -- a per-browser, tree-scoped
   * localStorage preference (the same convention gramps-web itself uses),
   * NOT Gramps' own db.default_person, and null when this browser has
   * never set one. Passed through here because a Worker has no
   * localStorage of its own to read it from; surfaced to a Gramplet as
   * `get_home_person()`. Unlike selectedType/selectedHandle this has no
   * view context to it, so the standalone editor's own preview run
   * carries it too. */
  homePersonHandle: string | null;
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

/** One piece of a `blocks` response (see PyodideWorkerResponse below) --
 * either a table built by columns()/row() calls, or raw markup from a single
 * html(markup) call, a run of consecutive print() calls (escaped and
 * `<pre>`-wrapped -- see pyodideWorker.ts's `print()`/`_flush_print()`), or
 * the code's own trailing expression value (same treatment, appended by
 * onmessage once the run finishes -- it's always chronologically last).
 * pyodideWorker.ts's `html()`/`row()`/`print()` each flush whatever the
 * *other* two have pending into their own block first, so calling any of
 * them more than once, or interleaving them in any order, produces one
 * block per call (or per uninterrupted run of print() calls) in the order
 * the code made them, instead of one silently overwriting another. */
export type GrampletBlock =
  | { type: "table"; columns: string[]; rows: TableCell[][] }
  /** UNSANITIZED HTML/SVG source (see pyodideWorker.ts's `html()`), reaching
   * the DOM exactly as-is -- GrampletResultView.tsx no longer runs this
   * through DOMPurify (removed; see that file's own HtmlOutput doc comment
   * for the trust-model reasoning), including real <script> tags and inline
   * event handlers. print() output and the trailing result value are still
   * HTML-escaped before landing here (unlike an explicit html() call's
   * markup), simply because there's no reason for those specifically to
   * ever contain markup. */
  | { type: "html"; markup: string }
  /** `st.columns(spec)` (stBootstrap.ts) -- one entry per side-by-side
   * region, each its own nested block list (whatever that column's `with
   * col:` block, or direct `col.write(...)`-style call, wrote into it, in
   * the same call-order/one-block-per-kind shape as the top-level `blocks`
   * list itself -- GrampletResultView.tsx renders these recursively).
   * `weights` is `spec` itself normalized to one number per column (an int
   * `spec` becomes `n` equal 1s); a column's rendered width is its share of
   * the weights' sum. Always the same length as `columns`. */
  | { type: "columns"; columns: GrampletBlock[][]; weights: number[] };

/** No `printed` field -- unlike the pre-blocks design, a Gramplet's own
 * print() calls aren't captured as a separate side channel (pyodideWorker.
 * ts's `stdout` option) shown before the run's own output regardless of
 * when they actually happened; they're just more blocks, in true call
 * order alongside everything else (see GrampletBlock above).
 *
 * Every variant carries `runId`, echoing the RunGrampletRequest it's for --
 * pyodideWorker.ts serializes execution (never two Gramplets running Python
 * at once in the shared worker/interpreter), but a still-running earlier
 * run's own messages (a `progress` from before it was superseded, or its
 * eventual `blocks`/`error` once it does finish) can still arrive after a
 * newer request was made. The caller checks `runId` against the request it
 * most recently made and ignores anything that doesn't match, rather than
 * assuming the very next message received must belong to that request. */
export type PyodideWorkerResponse =
  /** Sent once execution actually begins -- when a request was already
   * queued behind another one (pyodideWorker.ts serializes: at most one
   * Gramplet runs Python at a time), there can be an arbitrarily long gap
   * between posting a RunGrampletRequest and this arriving, during which
   * the caller shows a "queued" status rather than "running". */
  | { type: "started"; runId: string }
  /** From columns()/row()/html()/print() calls, and/or the code's own
   * trailing expression value -- see GrampletBlock above. Empty only when
   * the run produced none of the above. */
  | { type: "blocks"; blocks: GrampletBlock[]; runId: string }
  /** Not a terminal message -- zero or more of these can arrive mid-run,
   * each time print() is called (see pyodideWorker.ts's `_report_progress`/
   * `bridge.reportProgress`), always followed by exactly one `blocks` or
   * `error` message once the run actually finishes. `blocks` here is a
   * snapshot of everything produced so far, so the UI can just replace
   * whatever it was showing rather than trying to append/diff -- lets a
   * print()-then-time.sleep() loop's output show up live instead of only
   * once the whole run finishes. */
  | { type: "progress"; blocks: GrampletBlock[]; runId: string }
  /** `blocks` here is whatever the run produced before it crashed (also
   * flushed via pyodideWorker.ts's `_finalize_blocks()`) -- often the most
   * useful part of a traceback-only failure, so it isn't dropped on the
   * error path. */
  | { type: "error"; text: string; blocks: GrampletBlock[]; runId: string };
