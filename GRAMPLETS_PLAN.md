# Gramplets — implementation plan (gramps-connect)

Status (2026-10-09): Phases 1-4 implemented, uncommitted (code + wiki).
Phase 4 added people-without-sources, possible-duplicate-people and
age-at-death-by-decade to gramplet-store/ (each verified through the real
worker against the dev fixture), plus get_filter(object_type) so a
window Gramplet only picks up a filter from a list of the type it queries. Working title was
"on-demand Gramplets"; see [Naming](#naming) for the final terms.

## Goal

Today every Gramplet runs as a tab in the bottom panel of an object-type
list, automatically (on tab switch, tree change, and optionally
selection/filter change), small and fast, output shown and then discarded.
Those become **View Gramplets**.

Add a second, independent kind, called plain **Gramplets**. The user picks
one from a new top-level **Gramplets** menu and it runs in its own floating
window — which can be minimized so the
run carries on "in the background" while they keep working, and several can
be open and running at once. These can take seconds to minutes and are not
tied to whichever view happens to be open — closer in feel to a backend
Report, but still Python, editable, installed from the Gramplet Store, and
stored as a tagged Media object.

### Settled decisions

- **Names: "Gramplet" and "View Gramplet".** "Python Report" means nothing
  to a genealogist; what makes these different from Reports (editable, from
  the Store, community-written) is exactly what "Gramplet" already means in
  this app. The new kind takes the plain name, since it's the one with its
  own menu; the existing kind is qualified by where it lives.
- **Visibly separate from Reports.** Reports stay the server's Gramps report
  plugins; Gramplets get their own menu.
- **Independent of View Gramplets.** Each is one or the other. Gramplets
  never appear in the panel's (+) menu, View Gramplets never appear in the
  Gramplets menu, and existing View Gramplets (e.g. Age-at-Death Histogram)
  are not converted — any Gramplet version is a separate Store entry.
- **Results are shown in the window only.** No saving to Output, no saved
  results, in this plan (see [Later](#later)).
- **Not all of them are reports.** Some just show a table to act on
  ("possible duplicates", "people with no sources"). Writing to the tree is
  out of scope but must not need a rename later — it becomes a manifest flag.
- **No Uses checkboxes, no Options JSON** (decided 2026-10-09, after
  Phase 3 first shipped them). A Gramplet runs as soon as its window
  opens, always sees the main view's context, and asks for any input with
  its own `st.*` widgets (real work behind an `st.button`) -- one Python
  way of doing it, not a manifest schema on the side. New widgets, when
  needed, are modeled on Streamlit's API.
- **Browser-side only.** Runs in Pyodide like every View Gramplet. No
  gramps-web-api changes.

## Naming

User-facing terms, used consistently in the Store, editor, menus, help and
wiki:

| | View Gramplet | Gramplet |
|---|---|---|
| Store | listed under a **View Gramplets** heading/tab | listed under **Gramplets** |
| Store blurb | "Shows below a list and follows what you select" | "Opens in its own window from the Gramplets menu" |
| Editor choice | "View Gramplet — shows below a list" | "Gramplet — opens in a window from the Gramplets menu" |
| Where it lives | the panel's (+) menu | the Gramplets menu |

The Store is still the "Gramplet Store" and sells both kinds (two
headings/tabs, Gramplets first). Internally both remain "Gramplet"-tagged
Media objects with the same manifest type.

**Existing UI text needs a pass.** Everywhere that currently says
"Gramplet" about a panel Gramplet must say "View Gramplet" where it could
otherwise be ambiguous: the panel's own create/add/edit labels
(`PyodidePocPanel.tsx`), `GrampletEditDialog.tsx`, `GrampletHelpDialog.tsx`,
`GrampletStorePanel.tsx`, `MenuBar.tsx`'s "Add Gramplet…", i18n strings, and
the wiki's `Gramplets.md`/`Overview.md` (plus translated pages). The panel
itself can still be titled "View Gramplets".

Manifest field: `"kind": "view" | "window"` (missing = `"view"`, so every
existing Gramplet is a View Gramplet with no migration). "window" is
internal only — never shown to users.

## User-visible design

### The Gramplets menu

New top-level menu in `MenuBar.tsx`, between Tools and Reports:

```
Gramplets
  Chart            ▸  Age at Death by Decade…
  Data quality     ▸  People Without Sources…
  Utility          ▸  ...
  ─────────────
  Gramplet Store…
  New Gramplet…
```

- Submenus group by `category` (already a manifest/catalog field). Only
  Gramplets installed in this tree are listed.
- If none are installed, the top section is a single disabled
  "No Gramplets installed" item, so the Store entry below is the obvious
  next step.
- **Gramplet Store…** moves here from Help, and **New Gramplet…** (today's
  "Add Gramplet…") moves here from Add. Same permission gates as today.
  New Gramplet asks Gramplet or View Gramplet as part of creating it.
- Trailing "…" follows the Reports convention: picking an item opens its
  window; it doesn't run until Run is clicked.
- Picking a Gramplet whose window is already open focuses/un-minimizes it
  rather than opening a second copy (same rule as Topic windows).

### Gramplet windows

Floating, non-modal windows, mounted once outside `AppShell` (like
`FloatingTopicWindows`), so they survive navigating between views. A
window runs its Gramplet as soon as it opens:

```
┌ Age at Death by Decade ─────────────── ▾  ⤢  ✕ ┐
│ ███████████░░░░░░  Scanning people… 2,140/5,300  │  running
│                                       [ Cancel ] │
│ (output so far, streaming -- including any st.*  │
│  inputs + st.button("Run") the Gramplet draws)   │
├─────────────────────────────────────────────────┤
│ (result: same GrampletResultView as the panel)  │  done
└─────────────────────────────────────────────────┘
```

- **Minimize (▾)** shrinks the window to a chip at the bottom of the screen
  showing the name and status: a spinner plus `42%` (or the progress
  message) while running, ✓ when done, ⚠ on error. The run keeps going —
  that's the "background" behavior. Clicking the chip restores the window.
  When a minimized run finishes, the chip briefly highlights and a toast
  says "Age at Death by Decade finished" with a Show button.
- **Maximize (⤢, or double-click the title)** grows the window in place
  to nearly the whole screen. (Implemented this way rather than with the
  panel's portal-based Expand overlay: a window is already
  `position: fixed`, so resizing it needs no reparenting at all.)
- **Close (✕)** on a running window asks "Stop this Gramplet?" first.
- **Edit (✎)**, for authors (canAuthorGramplets()), opens the Gramplet
  editor; Save restarts the window with the saved version
  (restartGrampletWindow() bumps its generation, remounting it), or closes
  it if the edit made it a View Gramplet. A window Gramplet isn't in the
  panel, so this is its main edit path (the Media list's Edit Gramplet
  button also works).
- **Context** is read from the main view when the window opens (there's no
  Run again button -- close and reopen to start over): the open object-type list's selected record and filter, and
  the Home person -- the same three things a View Gramplet gets. An
  st.* widget click reruns with the *same* context as the run it belongs
  to. Context stays fixed for the whole run even if the user navigates
  elsewhere meanwhile.
- **Progress** is the Gramplet's own `st.progress()` bar, inline in its
  output (streamed live, like `print()`); the window itself just shows
  "Running…" + Cancel, and the minimized chip shows the latest bar's %.
- **Result** renders with the existing `GrampletResultView`: tables with
  clickable object cells, `html()`, plotly, `st.*` all work unchanged.
  Clicking an object link navigates the main view underneath; the window
  stays open.
- **Closing the browser tab loses all runs.** A `beforeunload` warning while
  any window is running. Accepted limitation.

### Window layout

- Default size ~560×480 px (Topic cards are 320 px wide, too narrow for
  tables/charts). Each window has its own position; drag by the title bar
  to move it, drag the corner to resize. New windows cascade from the
  bottom-right.
- Minimized chips line up along the bottom edge, right to left.
- **Shared dock with Topic windows.** Both kinds anchor to the bottom-right,
  so they'd overlap. Extract the slot allocation from
  `FloatingTopicWindows.tsx` into a small shared floating-window registry
  (open order, minimized state, z-order/focus) that both use. Topic windows
  keep their current look; only their positioning goes through the shared
  allocator.
- **Cap:** at most 5 Gramplet windows open. Unlike `topicWindows.ts`, a new
  one never silently evicts an old one (that would kill a run) — opening a
  6th says "Close a Gramplet window first."

### Where else it shows up

- **Gramplet Store** (`GrampletStorePanel.tsx`): separate Gramplets and
  View Gramplets headings/tabs, with the matching blurb. Installing a Gramplet says
  "Added to the Gramplets menu" instead of offering the per-view (+).
- **Gramplet editor** (`GrampletEditDialog.tsx`): Gramplet / View Gramplet
  choice at the top. Gramplet hides the View-Gramplet-only fields (`views`,
  listen toggles) and shows a Category field instead.
- **Media list**: both kinds are "Gramplet"-tagged Media, as today.

## Manifest changes (`types.ts` `Gramplet` + `CatalogEntry`, store README)

All optional, so every existing Gramplet keeps behaving exactly as today.

```jsonc
{
  "kind": "window",      // "view" (default when missing) | "window"
  "category": "chart"    // already in Store manifests; now also copied onto
                         // installed ones, and editable -- the menu submenu
}
```

`views`, `listensToSelection`, `listensToFilter`, `addedViews` are ignored
for Gramplets. Validated by grampletManifest.ts, shared by `isGramplet()`
and `build-gramplet-catalog.mjs`.

## Python API additions (`pyodideWorker.ts` BOOTSTRAP_PY, help dialog)

- `st.progress(value, text=None)` — Streamlit's API (int 0–100 or float
  0.0–1.0; returns a bar with `.progress()`/`.empty()`), drawn inline and
  updated in place, throttled to ~10 updates/s (decided 2026-10-09, replacing
  a top-level `progress(done, total, message)` that drove a window-only bar).
- `filter()`/`people()`/... with `limit=None` return every match.
- Existing `get_selected()` / `get_filter()` / `get_home_person()` keep
  working and return the context captured when the run started.
- `GrampletHelpDialog.tsx` gains a "Gramplets that open in a window" section.

## Execution model

### One worker per window

Today's `pyodideWorker.ts` is one shared worker per panel (plus one in the
editor), strictly serialized, **can't be cancelled** (its own `onmessage`
comment says so), and a newly posted request *replaces* any queued one. A
multi-minute run there would block every View Gramplet behind it.

So each Gramplet window owns its **own** `new Worker(pyodideWorker.ts)`:

- **Cancel = `worker.terminate()`**, then a fresh worker is created lazily on
  the next Run. Crude but reliable; needs no SharedArrayBuffer / COOP+COEP
  headers (the app isn't cross-origin isolated, so Pyodide's interrupt
  buffer isn't available).
- Several windows run truly in parallel, and View Gramplets stay
  responsive throughout.
- The worker stays alive after a run finishes, so `st.*` widget clicks
  are instant. It's terminated when the window closes.
- **Memory**: each Pyodide instance is tens to a few hundred MB depending on
  what's imported (plotly/pandas are the heavy ones). The 5-window cap
  bounds it; additionally, workers of windows that are idle (done, not
  running) beyond the 2 most recently used are terminated and re-created
  on demand (costing a re-boot on their next interaction, plus a rerun,
  since widget state lives in the worker).
- Boot cost (~1–3 s with cached assets) per window. Acceptable for
  something explicitly started.
- Protocol additions: a new response
  `{ type: "run-progress", done, total, message, runId }`, distinct from
  the existing block-snapshot `progress`.

### Token refresh mid-run

`RunGrampletRequest.token` is a snapshot ("not refreshed mid-run" is a
documented PoC limitation in `types.ts`) — fine for a 1-second panel run, a
real failure for a 10-minute one. Add a `{ type: "set-token" }` message the
window posts whenever `getToken()` refreshes (or on a timer before expiry),
handled outside the queue/replace logic so it never displaces a run.

### Whole-tree data access

`filter()` pages transparently but defaults to `limit=50`, and
`people()`/`get_object()` cost one round trip per object — the main
performance risk. For v1:

- Document the pattern: `filter(..., what=[...], limit=None)` for scans;
  full objects only for the rows actually shown.
- `limit=None` means "all" (done in Phase 1 -- it used to return nothing); verify paging over a
  few thousand rows on both SQLite and Postgres (path filters read every
  row — see CLAUDE.md — so a whole-tree scan is O(tree) server-side).

## Phases

1. **Plumbing** — manifest fields + validation (`types.ts`,
   `grampletMedia.ts`, catalog build script, store README);
   `st.progress()`/`set-token` in the worker. Unit tests for
   manifest validation.
2. **Windows** — shared floating-window registry (migrate Topic windows onto
   it), `GrampletWindow.tsx` + `GrampletWindows.tsx`, per-window worker,
   run on open, progress, Cancel, minimize chips,
   finish toast, expand overlay, `beforeunload`.
3. **Menu, Store, editor** — done. Gramplets menu (category submenus once
   there's more than one category; `category` now copied onto installed
   manifests and editable), "No Gramplets installed" empty state, Store and
   New Gramplet moved into it (New defaults to Kind = Gramplet), Store split
   into Gramplets / View Gramplets tabs, "View Gramplet" wording in the
   panel/editor/help.
4. **Store content** — 2–3 Gramplets that exercise it (e.g. "People
   Without Sources", "Possible Duplicate People", "Age at Death by
   Decade"), each a new entry, with st.* inputs where useful and `st.progress()`.

Each phase with visible UI updates the wiki in the same pass.

## Wiki

Per CLAUDE.md, ship with the code: `Gramplets.md` (Gramplets vs View
Gramplets; Gramplets menu; Cancel/minimize; writing one with
st.* inputs and `st.progress()`), `Overview.md` feature list (Gramplets menu),
and wherever the Store's and "Add Gramplet…"'s current menu locations are
described. Translated pages via `sync-wiki-translations.py` bookkeeping.

## Later

- **Saving results** to the Output view (`GENERATED_VIEW`) via `jobsApi.ts`'s
  `uploadMedia`/`getOrCreateTagHandle`/`tagAndDescribeMedia`, with a
  provenance Note (Gramplet version, context). Open sub-questions
  then: tag name (not `Gramplet`, which marks Gramplet code), and whether to
  inline plotly.js (~3.5 MB) or reference the CDN.
- **Writing to the tree**: `"changes": true` manifest flag, "Changes your
  tree" badge, editor-level permission to run. Python *proposes* changes
  (`propose_update(obj)`, `propose_create(obj)`); the window shows a review
  list with per-row checkboxes; Apply commits them as one batch through the
  app's existing create/update functions so they land in transaction
  history and live-sync. (TODO.md's "Allow gramplets to edit/create
  objects.")
- **Whole-tree snapshot DB** in the worker, possibly enabling unmodified
  desktop Gramps report/gramplet code.
- **Stale result hint** ("tree changed since this ran") via history polling.

## Open questions

1. ~~Should window positions/sizes be remembered per Gramplet?~~ Yes --
   done (localStorage, per Gramplet).
2. Should open windows be reopened (and rerun) after a reload? Not for v1.
3. Cancel terminates the worker, which also drops st.session_state -- a
   Gramplet's typed-in st.* inputs reset after Cancel. Keep widget values
   on the page side if that turns out to matter.
