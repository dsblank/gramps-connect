# Uncapped selection + large bulk delete — implementation plan

Client-side only. Uses gramps-web-api v3.25.0's
`POST /objects/delete-by-handle/?background=true` (#1131) when available.
No backend changes.

## Goal

Let someone select any number of rows in a list (shift+click a long range,
or Ctrl/Cmd+A for every row the current filter shows) and act on them with
the bulk **Delete** and **Tag** buttons the selection pane already has. No
new buttons, menus or modes: the existing UI just stops being capped.
Tools → **Delete items…** stays the whole-type delete, unchanged.

## Decisions (agreed 2026-10-30, implemented the same day)

1. **Fix the selection rather than add a "delete matching" feature.** The
   app's own model drives the UI: selection is how you say "these
   records", and Delete/Tag act on a selection.
2. **Large deletes need a password check.** Above a threshold
   (`FRESH_LOGIN_DELETE_THRESHOLD`, proposed 500), Delete requires a fresh
   token. If the session's token isn't fresh, `ReloginDialog` asks for the
   password, the same flow Delete items… uses (`DeleteAllDialog.tsx`).
   - This is a **client-side guard against mistakes** (a stray Ctrl+A on
     the wrong filter), not a security control: `delete-by-handle` only
     needs `DeleteObject` server-side and doesn't require a fresh token,
     so the API can still be used directly as it can today. The wiki
     should not describe it as a permission.
3. **Tag gets no password check.** It's additive and easy to reverse. It
   gets progress and Cancel instead.
4. **Selection stays a list of handles.** No predicate/range model: the
   whole filtered result is already in the local cache (see below), so
   explicit handles are cheap. It's still one array in click order, so
   every existing single-select consumer is untouched.

## Why the cap exists, and why it can go

`MAX_RANGE_SELECT = 50` (`DataTable.tsx:27`) says it stops "a fetch/select
of tens of thousands of rows". But:

- **Every row is already local.** After any search/filter, `ViewStore`'s
  background fill loads every page of the result into its sql.js table in
  server order (`runQuery()`'s fill loop; `whenFullyLoaded()` waits for
  it). `selectRange()` never fetches.
- **A clicked range is always loaded.** The fill loads from the top down,
  and a click lands on a rendered row, so every row between anchor and
  click is already in the cache. The "row not loaded, bail" branch can't
  trigger from a click.

The real costs are elsewhere, and each is fixable:

| Where | Today | Cost at 50,000 |
|---|---|---|
| `DataTable.tsx:294` highlight | `selectedIndices.includes(index)` per rendered row | ~40 × 50k comparisons per render |
| `selectRange()` | `getHandleAt(i)` = one SQL query per row | 50k queries |
| `reconcileSelection()` (every live change) | `getIndexForHandle(h)` = one SQL query per selected handle | 50k queries per live change |
| `SelectionBulkView` | one `fetchPlainObject` request per selected handle, for labels | 50k API requests (rate-limited) |
| `BulkDeleteButton` | one synchronous request with every handle | proxy timeout risk |
| `BulkTagButton` | one PATCH per handle, no progress | minutes, no feedback |

## Design

### 1. `ViewStore` selection (`store/viewStore.ts`)

- **`selectRange(index)`**: drop the `maxCount` parameter. Read the range
  in **one** query: `SELECT handle FROM <view> ORDER BY rowid LIMIT ?
  OFFSET ?` (count, lo). Not `rowid BETWEEN`: rowids stay in order but get
  gaps after live deletes, which is why `getHandleAt()` uses `OFFSET` too.
  Keep the bail if the result is short (defensive).
- **New `selectAll()`**: `await whenFullyLoaded()`, then select every row
  in one query. The anchor (`selectedHandle`/`selectedIndex`) stays on the
  row that was already selected, so the detail/bulk pane and the URL
  don't jump.
- **`reconcileSelection()`**: one pass instead of one query per handle.
  Read every handle once in order (`SELECT handle FROM <view> ORDER BY
  rowid`) into a `Map` of handle → position (the 0-based index, not the
  rowid, for the same gaps reason), then look each selected handle up
  there. Only
  done when the selection has more than 1 handle; the single-select path
  stays as is.
- **New `selectedSet` getter** (memoized per selection change):
  `Set<number>` of selected indices, for highlighting.
- Unchanged: `select()`, `toggleSelect()` (O(n) array copy per ctrl+click
  is fine), `clearSelection()`, `runQuery()` clearing the selection.

### 2. Table (`components/DataTable.tsx`)

- Remove `MAX_RANGE_SELECT`. Shift+click calls `selectRange(index)`.
- Highlight via `selectedSet.has(index)`.
- **Ctrl/Cmd+A** while the table has focus (not when a text field does,
  so the search box keeps its normal select-all) calls `store.selectAll()`.
  While the fill is still running, show the selection pane's count as
  "Selecting… 12,000 of 48,000" (from `loadedCount`/`totalCount`) until it
  settles.
- The row hint tooltip mentions Ctrl/Cmd+A alongside ctrl/shift+click.

### 3. Bulk pane (`components/related/SelectionBulkView.tsx`)

- Header count formatted with thousands separators.
- **Labels for the first 100 handles only** (still `fetchPlainObject` +
  `summaryLine`, bounded), then "…and 4,900 more". Clicking a listed row
  works as today.

### 4. Delete (`components/related/BulkDeleteButton.tsx`)

The confirm dialog's title and button carry the count ("Delete 4,900
people"). On Delete:

1. **Password check:** if `handles.length > FRESH_LOGIN_DELETE_THRESHOLD`
   and `!isTokenFresh()`, open `ReloginDialog`; on success, continue.
   Cancel aborts with nothing deleted.
2. **Places only:** `reconnectPlaceChildren(token, handles)`, made
   scalable (see §6).
3. **The request**, chosen by size and server:
   - **≤ `BULK_SYNC_LIMIT` (proposed 500):** today's synchronous
     `deleteObjectsBulk()`. Unchanged behavior for every small selection.
   - **Larger, server ≥ 3.25.0:** new `deleteObjectsBulkBackground()` in
     `mergeApi.ts`: `?background=true`, `apiFetch` with `{ lane: "long" }`,
     returning a `TaskPostResult` (202 → task, 200 → done inline on a
     Celery-less desktop server, like `postTask()`). Poll the task and show
     a progress bar from `result_object.current/total` (the task reports
     about 100 times). One transaction.
   - **Larger, older server:** `deleteObjectsBulk()` in chunks of
     `BULK_SYNC_LIMIT`, sequentially, with "Deleted 1,500 of 4,900"
     progress. Several transactions. On failure, stop, report how many
     were deleted, and requery so the list shows what's left.
4. While deleting, the dialog can't be closed (as in `ReindexDialog`).
5. **Done:** `requeryDebounced()`, `clearSelection()`, notification
   "Deleted 4,900 people". A 409 `task_locked` (import/restore/repair
   running) already becomes a readable message via `parseErrorMessage()`.

### 5. Tag (`components/related/BulkTagButton.tsx`)

- Above ~50 handles: progress ("Tagged 300 of 4,900") and a **Cancel**
  button that stops after the current request. Requests go through
  `apiFetch`, so the in-flight cap and 429 retry already pace them.
- On cancel or failure: report how many were tagged. Nothing to roll back
  (tagging is additive and idempotent per object).

### 6. Places (`store/placeReconnect.ts`)

`reconnectPlaceChildren()` doesn't scale, and has a latent bug:

- one sequential `fetchPlainObject` per deleted place, for its parent;
- every deleted handle spliced into a single `where_expr`;
- **only the first page (1000) of enclosed children is read**, so a
  selection enclosing more than 1000 places leaves the rest dangling
  today.

Change:
- Parents via a paged `/query/` selecting `handle` + `placeref_list`, with
  the handle list in chunks (e.g. 200 per `where_expr`) instead of N GETs.
- Children query chunked the same way and **paged to the end**.
- Child PATCHes stay one per affected child.

### 7. Server version (`store/metadataApi.ts`)

- `serverVersionAtLeast(metadata, "3.25.0")`: numeric major/minor/patch
  compare of `gramps_webapi.version`. Missing/unparseable counts as older
  (falls back to chunked synchronous deletes, which works everywhere).
- A cached `getServerMetadata()` (one fetch per session) instead of each
  caller fetching its own (`App.tsx`, `ReindexDialog`).

### Unaffected

- **Live sync in other tabs:** a large delete arrives as a big transaction,
  and more than 20 same-table changes per poll (`REQUERY_THRESHOLD`,
  `useLiveSync.ts`) already makes each view requery once.
- **Single-select consumers** (RelatedPanel, Gramplets' `get_selected()`,
  `useHistorySync`, `navigateToHandle`) read the anchor only.
- **Merge** stays exactly-2.
- **Tools → Delete items…** is untouched.

## Phases

1. **Selection core:** `selectRange` single query, `selectAll`,
   `reconcileSelection` one pass, `selectedSet`; tests with a few thousand
   rows (range, select-all waiting on the fill, live delete of a selected
   row, requery clearing the selection).
2. **Table + bulk pane:** remove the cap, Set highlight, Ctrl/Cmd+A
   (focus-scoped), bounded labels, count formatting.
3. **Delete:** threshold + `ReloginDialog`, background request with
   progress, chunked fallback, version check + cached metadata; tests for
   202/200/chunked paths and the threshold.
4. **Tag:** progress + Cancel.
5. **Places:** scalable `reconnectPlaceChildren()` (fixes the 1000-child
   bug for today's selections too); tests with nested deleted parents and
   more than 1000 children.
6. **Wiki** (`Data-Model-and-Editing.md`; multi-select isn't documented
   anywhere yet, only Merge's ctrl/cmd+click near line 190):
   - "Selecting several records": click, ctrl/cmd+click, shift+click (any
     length), Ctrl/Cmd+A selects everything the current filter shows.
   - "Deleting or tagging many records": the count in the dialog, the
     password check above the threshold (as a safeguard against
     mistakes), progress, and the 3.25.0 single-transaction vs older
     servers' several-transaction behavior.
   - Link "select everything a filter shows" from `Search-and-Filters.md`.

## Verification

- Unit tests per phase.
- Manual, **after updating the :5003 fixture to v3.25.0** (pre-3.25 today,
  which also exercises the chunked fallback first):
  - Ctrl/Cmd+A on a filter of a few thousand people while the fill is
    still running; highlight and pane stay responsive.
  - Delete above the threshold with a stale token → password prompt →
    background delete with progress; with a fresh token → no prompt.
  - 409 while an import runs.
  - Places with nested deleted parents.
  - Another tab open on the same list.
- Per the fixture-write rules: one large test delete at a time, gated on
  earlier steps passing, restored via
  `/api/transactions/history/<id>/undo` (one transaction on 3.25.0).
- Scale check on the scale-100k fixture (:5101), using an existing tree,
  never a new 100k one: Ctrl/Cmd+A on a large unfiltered list for time to
  select and render responsiveness. **Selection and highlight only; no
  delete there.**

## Open questions

1. ~~**Threshold values.**~~ Settled 2026-10-30: one threshold,
   `BULK_DELETE_THRESHOLD = 500` (`store/bulkDelete.ts`), for both the
   password check and the switch away from one synchronous request.
2. **Undo wording.** On 3.25.0 a large delete is one transaction, so
   history undo can restore it, yet the dialog says "There is no undo."
   Out of scope here, but worth deciding separately.
