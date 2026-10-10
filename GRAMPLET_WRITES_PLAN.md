# Gramplet Writes Plan

Status: Phases 1-2 done 2026-10-10; Phase 3 (Help/wiki done alongside each
phase; the Store example still to do). Changes from the plan below, made
while building Phase 2:
- The Gramplets menu marks such Gramplets with ✎ but doesn't disable them
  for users without Editor rights -- a dry run is still useful to them, so
  only the window's Run button is disabled.
- Commits are always synchronous; background=true isn't used yet (it
  returns a Celery task to poll, and Desktop has no Celery anyway).
- A commit-changes message from a run a newer run replaced is refused.

Let Gramplets change the tree, not just read it. There are no limits on
*what* a Gramplet may write; the safeguards are an explicit per-Gramplet
opt-in, a dry run, the user's own role, and undo.

## Goals

- **Writing is just changing a record**, the way it is in Gram.py Script
  (`../addons-source/GrampyScript`):

  ```python
  for person in people(where="len(citation_list) == 0", limit=None):
      person.private = True
  ```

  No transaction objects or commit calls to learn. Optional grouping:
  `begin_changes("Mark unsourced people private")` / `end_changes()`.
- **Opt-in per Gramplet:** a **[ ] Allow data changes** checkbox in the
  Gramplet editor. Off by default; nothing about a Gramplet with it off
  changes.
- **Dry run**: runs the same code, writes nothing, shows exactly what
  would change.
- **Real run**: commits automatically, with no extra review step. Only
  from a Gramplet's own window, **never from the Gramplet editor**.
- **View Gramplets never write.** They rerun on every selection change,
  which is the wrong trigger for writes.
- No gramps-web-api changes.

Out of scope for now: creating records (a `new()` call). Later change.

## Where the authority comes from

The worker already runs with the user's own token (`pyodideWorker.ts`
`currentToken`), so a Gramplet can never write more than the person
running it could by hand. That's the only limit on scope. `POST
/api/transactions/` requires `AddObject` + `EditObject` +
`DeleteObject`, so in practice **Editor and above** can run Gramplets
that change data; everyone else can still run the rest.

## "Allow data changes"

- A checkbox in `GrampletEditDialog`, saved in the Gramplet's manifest
  as `allowChanges: true`. Only shown when Kind is Gramplet; switching
  Kind to View Gramplet hides it and clears it. Only Owners/Admins can
  set it, because only they can save Gramplets at all
  (`GRAMPLET_AUTHOR_PERMISSION`).
- Store catalog entries can carry `allowChanges: true`, which installing
  copies into the manifest.
- **With it off, records behave exactly as today:** no snapshots, no
  change tracking; changing a record in Python only changes that Python
  object. So existing Gramplets that reformat a field before printing it
  are unaffected, and there's no detection problem: the author says
  whether the Gramplet writes. `delete()`, `begin_changes()` and
  `end_changes()` raise "This Gramplet isn't allowed to change data; turn
  on Allow data changes in the Gramplet editor."
- The worker gets the flag with each run request and is the only thing
  that enforces it. A View Gramplet run never gets it, whatever its
  manifest says.

## Python API (with Allow data changes on)

Same names and behavior as Gram.py Script wherever it has one:

| Call | Effect |
|---|---|
| `record.field = value`, `record.a.b = value` | Changes the record |
| `record.set_privacy(True)` (any `set_*()`) | Changes the record |
| list edits, e.g. `person.event_ref_list.append(...)` | Changes the record |
| `delete(record)` | Deletes it. Like Gram.py Script, does **not** unlink references to it |
| `begin_changes(message)` / `end_changes()` | Optional: groups changes into one transaction (one undo step) with that message. Without them, the whole run is one group named after the Gramplet. An open group is closed automatically when the run ends |

"Records" here are every whole record a Gramplet gets: `people()` and
the other plural functions, `get_raw_object()`, `get_object()`,
`get_selected()`, `get_home_person()`, and the `db.get_*` /
`db.iter_*` methods. `filter()` results are **partial** (only the
`what` fields), so changing one raises: "filter() returns only some
fields; use people()/get_raw_object() to change a record."

### How changes are found: snapshot and compare

Not setattr write-through (Gram.py Script's `DataDict2` callback):
that misses list edits like `.append()`, and a web write per assignment
would be far too slow. Instead:

- Every whole record handed to the Gramplet is registered with a
  snapshot of its JSON as read.
- **Identity map:** asking for the same handle again in a run returns the
  same Python object, so a Gramplet always sees its own changes.
- At each flush point (`end_changes()`, or the end of the run), every
  registered record is compared with its snapshot: different → update;
  `delete()`d → delete. A record changed several times is written once,
  in its final state.
- `set_*()` and other methods run on the real gen.lib object `DataDict`
  builds lazily; wrap `set_*` (as `DataDict2.set_wrapper` does) so the
  dict is re-synced from the object afterwards. `get_object()` results
  are real gen.lib objects and are compared via `object_to_dict()`.
- Before sending, each changed object is validated against its class's
  `get_schema()` with `jsonschema` (a Pyodide package), because
  `/transactions/` doesn't validate and a malformed object can corrupt
  the tree. An invalid one fails the whole group with the field path.

In a **dry run**, server-side queries (`filter()`, `count()`, the
`where` in `people()`) don't see changes not yet committed. In a real
run, earlier groups have already committed, so later queries see them.
Document this as the one way a dry run can differ from a real run.

## Running

| | Dry run | Real run |
|---|---|---|
| Where | Gramplet window, and the Gramplet editor's preview | Gramplet window only |
| Flush point | Records the changes for the summary | Commits that group right then |
| Server writes | None | One `POST /api/transactions/` per group |
| After the run | Change summary | Change summary + **Undo** |

- **Gramplet window** (from the Gramplets menu), for a Gramplet with
  Allow data changes: **Run** and **Dry run** buttons. `st.*` widget
  reruns use whichever of the two started the current result, so a
  Gramplet can show what it would change and then
  `if st.button("Apply"):` change it. Real-run results are marked in red
  in the title bar.
- **Gramplet editor** (`GrampletEditDialog`): with the checkbox on, its
  preview is always a dry run, labeled so. There's no way to do a real
  run there; to apply changes, save it and run it from the Gramplets menu.

### Commit path (real run)

At each flush the worker posts a `commit-changes` message to the main
thread and awaits the reply, which the main thread sends after:

1. `POST /api/transactions/?message=<msg>` with `force=false`. `old` is
   the snapshot taken when the Gramplet read the record, so if anyone
   changed it since then, the whole group is rejected instead of
   overwriting their edit. Large groups set `background=true` (only
   async where Celery is configured, i.e. Docker; Desktop runs it
   synchronously). The threshold is to be measured.
2. Replying with the transaction the server returned (kept for Undo) or
   the error, raised as a Python exception at the `end_changes()` call
   (or reported after the run, for the implicit group).

The commit goes through the main thread rather than straight from the
worker so that `new()` can later use `assignGrampsIds()`
(`store/grampsIds.ts`), which needs the main thread's caches.
(`/transactions/` rejects an add without a `gramps_id`, so `new()` will
also need a fallback to Gramps' built-in ID templates when the tree has
none.)

After a group commits, its records get fresh snapshots, so a later
group only writes what changed again. Earlier groups stay committed if a
later one fails; the summary says which committed. Live sync
(`historyPoll.ts`) refreshes open views on its own.

### Undo

After a real run, the window shows **Undo**: posts each group's returned
transaction to `/api/transactions/?undo=true`, last group first.
`force=false` means it refuses if someone has changed those records
since, which is the safe answer. Kept only for the window's current
result.

### Change summary (both modes)

Grouped by change group, then by record: **Updated** Place P0012:
`name.value` "york" → "York" (JSON diff of snapshot vs. new);
**Deleted** Event E0040. Collapsed past a few dozen rows, with totals.
For deletes, a backlinks check flags "still referenced by 3 records" so
dangling references show up before a real run.

## UI

- **Gramplet editor**: the Allow data changes checkbox (Gramplet kind
  only); dry-run label on the preview.
- **Gramplets menu**: Gramplets with Allow data changes get an
  edit-style icon next to their label; disabled (with a tooltip) for
  users lacking the three permissions.
- **Gramplet window**: Run / Dry run buttons and Undo, as above.
- **Gramplet Store**: "Changes your data" badge on such entries.

## Phases

1. **Opt-in + change tracking + dry run.** Checkbox and manifest field,
   record registry with snapshots and the identity map, `set_*` re-sync,
   `delete()`/`begin_changes()`/`end_changes()`, schema validation,
   change summary, editor preview as dry run. No server writes yet;
   useful on its own.
2. **Real run + Undo.** Window Run/Dry run buttons, `commit-changes`
   message, `/transactions/` commit, error reporting, Undo, menu icon +
   permission gate, Store badge.
3. **Docs + example.** `GrampletHelpDialog.tsx` API section; wiki
   (`Gramplets.md`: a writing section, and update the role table so
   running Gramplets that change data is Editor+); a Store example such
   as Gram.py Script's "mark unsourced people private."

## Testing

- Vitest: snapshot diffing (nested fields, list edits, `set_*`, a record
  changed twice), the flag is ignored for View Gramplet runs, checkbox
  hidden/cleared for View Gramplet kind.
- Against the :5003 fixture: with the flag off, changing a record writes
  nothing and `delete()` raises; dry run writes nothing (transaction
  history unchanged); real run produces one history entry per group; an
  `old` conflict rejects the group; Undo restores; an invalid object is
  rejected before any request; the editor never sends a write.
