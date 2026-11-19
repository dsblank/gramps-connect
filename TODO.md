# TODO

Open items only. When something here is done, delete it; git history and
the wiki are the record of what shipped.

## CI / build gating

- No ESLint/Prettier config exists anywhere in the repo — either add one
  (and lint in CI) or explicitly decide linting is out of scope; don't
  silently skip it.
- Decide whether `deploy/Dockerfile` should also build in CI (would have
  caught several bugs found the first time `deploy/` was built). The build
  itself is fast (it layers `app/`'s frontend onto the official
  `dmstraub/gramps-webapi` image), but pulling that multi-GB base image on
  every push may be worth scoping to changes under `deploy/` or `app/`.

## Architecture / product

- **Presence layer** (who's viewing/editing what) — deliberately ephemeral,
  in-memory/Redis, kept separate from the durable transaction-history sync
  path. Today's `activeUsers.ts` only infers who recently *edited* from
  `historyPoll.ts`; it can't see who's only reading, since gramps-web-api
  has no session/heartbeat/presence concept at all.
- **Merge/conflict UX** for genuinely concurrent edits to the same object —
  open design question. A conflicting save is blocked, so nothing is
  overwritten, but the edit has to be redone; there's no side-by-side view
  or merge. Low priority: two people editing the same record at once is
  rare.
- **Generations graph (`FamilyGraphView.tsx`) descendant-subtree placement**:
  `DescendantChildrenBox`'s expanded-children row is centered via plain CSS
  (`Stack align="center"`) relative to the *whole* children box's width, not
  anchored to whichever specific child triggered it. When only one child
  (of several) has been expanded and that child sits off-center in a wide
  row, its subtree renders under the row's overall midpoint instead of
  under that child — the connector line still points correctly, but
  visibly stretches a long diagonal to bridge the gap. Fixing this properly
  means switching that subtree row from CSS flow centering to measured
  absolute positioning (the same `getBoundingClientRect`-based technique
  the connector lines already use, setting each subtree's own `left` from
  its trigger's measured center) — needs a `position: relative` container,
  a measure-then-reposition pass, and explicit height reservation since
  absolutely-positioned children don't contribute to their parent's layout
  height. The ancestor side (`SiblingGroupWithAncestry`) doesn't have this
  bug.

## Editing gaps

- **Person / Family** — LDS ordinances are fully read-only: no edit, add or
  detach.
- **Map overlays and alternate place names** — an image overlay's date
  gating reads only its Place's *primary* name date (`visualData.ts`,
  `storyHydration.ts`), not dated alternate names (`alt_names`).

## gramps-web-api 3.26 follow-ups

What 3.26.0 makes possible that gramps-connect doesn't use yet, roughly
most useful first:

- **Save conflict check via ETag** — a plain `GET /api/{type}/{handle}` now
  returns the same `hash_object` ETag that PUT checks `If-Match` against
  (#1173). `draftStack.ts`'s `saveAll()` instead re-fetches every edited
  record and diffs it before saving (an extra request per record, and a
  window between check and write). Keep the ETag from when the editor
  opened, send `If-Match`, and turn a 412 into the existing "changed
  elsewhere" message.
- **Admin user tools** (`UserManagementPanel.tsx`) — `PUT /users/<name>/`
  now takes `password` for a user of lower role than the caller (#1157);
  the panel only offers "Send password reset email". And
  `POST /users/<name>/merge/` with `{"source": ...}` merges two accounts
  (site admins, fresh token; #1148).
- **Merge Tags in one transaction** — `mergeApi.ts`'s `mergeTags()` PATCHes
  every record that has the losing tag, one by one and not atomically.
  `/objects/edit-by-handle/` (`bulkEdit.ts`) can do `add_tag` winner +
  `remove_tag` loser per record type, one transaction per type.
- **Filter errors that point at the problem** — a bad GOQL expression or
  rule is now a 422 with the error keyed by where it is in the request,
  e.g. `{"query": {"rules": {"rules": {"0": {"values": ...}}}}}` (#1180),
  and `/query/` errors name the field (`where_expr`, `select.1`; #1164).
  The filter editor could highlight that rule/expression instead of a
  general error.
- **`env` in `/query/`** — `{"where_expr": "handle in Env.BOOKMARKS",
  "env": {...}}` (#1164) would let Bookmarks/Visited filter on the server
  instead of matching handles in the browser.
- **Register link on the login page** — `GET /api/register/config/`
  (no auth) says whether sign-up is open (#1175); `LoginForm.tsx` has no
  Register link at all.
- **Report the undo conflict false alarm upstream** — not our bug, and
  gramps-connect doesn't call undo, but we know the cause:
  `/transactions/history/<id>/undo` compares a record changed twice in one
  transaction (e.g. Merge Places) with the transaction's *first* change to
  it, not its last, so it reports a conflict that isn't there. Hit 7 times
  restoring Blank Family on 2026-11-18 (e.g. the undo of merge 2401 into
  P0337). Becomes our problem if gramps-connect adds an Undo button.
- **Drop the `order_by` fallback** — every supported server takes string
  `order_by` now; `serverCapabilities.ts`'s `supportsOrderByStrings()` /
  `withOrderByFallback()` (c7ab940, 11 call sites) can go.
- **Relationship chart export** — the tree and fan charts export to
  PNG/JPEG/SVG/PDF; the Relationship chart (window, Graphs view,
  Gramplets) can't, since it's HTML cards over SVG lines, not one SVG.
- **Two selected people, Shift+click order** — the relationship sentence
  describes the second selected from the first; with a Shift+click range,
  "first" is just the earlier row in the list.

## Undo and reasons for changes

The server undoes only whole transactions; a record's History entry is that
record's share of one. Plan: undo whole changes in context, plus a
per-record revert where that's safe, plus an optional reason on each save.
Test only on the :5102 bench tree, undoing only ids created there.

- **Change page** — one transaction (`GET /transactions/history/<id>`):
  what it was, who and when, its records grouped Added / Updated /
  Deleted, each expanding to the existing diff (`historyDiff.ts`); deleted
  records shown as they were; large changes paged with counts by type.
  Reached from a footer in `HistoryButton.tsx`'s What changed dialog
  ("Part of 'Merge Places' · 3 records changed together") and from a
  **Records | Changes** toggle on View > Change Log (`ChangedView.tsx`; list
  history with `page=`, never the whole listing). A change already undone
  shows "Undone by change #N".
- **Undo whole change** on the Change page — `GET …/undo` check, then
  `POST` as a task with progress; `?message=` "Undo of change #N" so the
  Undone-by link can be found. Three outcomes: clean → confirm; the
  server's false alarm (record changed twice in one transaction, compared
  with its first change — see the 3.26 item above) → verify each record
  against the transaction's *last* write for it, and only then force; a
  real conflict → list the records changed later (who, when, link to that
  change), no Force button. Password above 500 records, as bulk delete.
  Needs Add+Edit+Delete permission (Editor and up); others see the page
  without the button.
- **Revert this record** in What changed — an ordinary save in the app, so
  it shows in History and can itself be reverted. Applies the inverse of
  that entry's diff only (lists item by item: "remove tag Calendar", not
  "set tags back"), so later edits to other fields stay. Through the normal
  save conflict check. Cases:
  - only this record in the transaction → no warning;
  - part of a bigger change, own fields only → warning naming the change
    and saying the other records keep it, with a link to the Change page;
  - those fields changed again later → warn who/when will be overwritten;
  - would reference a record that no longer exists (e.g. a place removed
    by the same merge) → blocked, offer undoing the whole change;
  - record was added → revert is a delete, warn which records from the
    change refer to it; record was deleted → re-create, warn that records
    which pointed to it won't again.
- **Undo after delete** — replace "This cannot be undone from here." in
  `DeleteButton.tsx` / `BulkDeleteButton.tsx` with a ~10 s notification
  carrying Undo of that delete's transaction (no dialog; a conflict falls
  back to the full dialog). Check first that the DELETE response gives the
  transaction id.
- **Reason for change** — optional message stored in the transaction
  description, like a commit message: a field above Save in every editor
  and in the bulk Tag/Privacy/Delete, Merge and Undo dialogs, with recent
  reasons offered; per-tree setting Off / Optional / Required; stored as
  "Edit Person: <reason>"; shown in History, What changed, the Change page
  and the Changes list, and searchable there. Blocked on the server: plain
  `PUT`/`POST`/`DELETE` and edit-by-handle have fixed descriptions; only
  `/api/transactions/` and undo take `?message=`. Routing saves through
  `/api/transactions/` is not the fix — it needs Add+Edit+Delete (no
  Contributors) and skips `update_object()`'s family/person back-reference
  updates and Gramps ID check. Proposed upstream on 2026-11-18 (gramps-web-api
  Discussions: optional `message` on the write endpoints); until then only
  Gramplet writes and undo can carry a reason.
- **Wiki** — `Data-Model-and-Editing.md` says fixed places "can be undone
  from its **History**" (Wikidata place fixes), which isn't true yet; fix
  it, and replace "No undo yet" when this ships.

## Feature ideas / backlog

Roughly by value, most first:

- **DNA support** — `/people/<handle>/dna/matches` (which since 3.26
  returns each match's relationship `distance`, #1182), `/ydna`,
  `/parsers/dna-match` on the API side; `gramps-web` has a match list,
  Y-DNA/lineage view, and chromosome browser (`GrampsjsViewDnaMatches`,
  `GrampsjsViewYDna`, `ChromosomeBrowser.js`). A large, mostly
  self-contained feature area, not a small add.
- **Photo face-detection / OCR** — `/media/<handle>/face_detection` and
  `/media/<handle>/ocr` are real server-side capabilities with no UI at
  all; would be a differentiating feature for the Media view.
- **Stale-search-index nudge** — `search.sifts.semantic_index_stale` is
  available but `ReindexDialog.tsx` only checks the boolean
  `server.semantic_search` flag to decide whether to show a reindex
  checkbox; nothing uses the staleness flag to suggest reindexing.
  (Check first: gramps-web-api discussion #1045 proposes removing semantic
  search.)
- **Research Tasks** — `gramps-web` has a to-do-list feature built as a
  specialized Source subtype with task notes (`GrampsjsViewTask(s)`/
  `NewTask`). No equivalent here.
- **Service worker for app-shell caching**: `app/` registers none, so
  every tab load/reload depends on the network being up at that instant —
  a laptop resuming from sleep mid-load can hit `ERR_NETWORK_CHANGED` on
  the hashed `index-*.js`/`index-*.css` bundle and render a permanently
  blank page (no JS ever ran, so nothing can catch or recover from it; a
  manual reload fixes it once the network's back). `vite-plugin-pwa`/
  Workbox is the standard fix, and is low-effort for basic offline
  app-shell caching; the real ongoing cost is cache invalidation on deploy
  (get it wrong and users silently get stuck on a stale JS bundle until
  they close every tab).
- Allow gramplets to create objects (a `new()` call; changing and deleting
  already work, creating was left out of scope).
- Allow more types of addons: tools, reports.
- Ability to generate PDF forms (add PDF importer).
- Move under gramps-project — would this enable translations?
- **Map overlay → source image back-reference**: an overlay file embeds
  the source image's handle as an app-internal `media-handle:<handle>` fake
  URL (`packages/story/src/mapEdit/mapFile.ts`'s `MEDIA_HANDLE_PREFIX`,
  read back by `app/src/store/kmlMedia.ts`) — one-directional and invisible
  at the Gramps level. It won't show up in a backlink/"referenced by"
  query, and desktop Gramps' remove-unused-objects tool won't know the two
  are related; if the image is later detached from whatever else
  references it (e.g. a Source), the overlay silently breaks with no
  warning. Cheap fix: `MapItemEditorDialog.tsx`'s `handleSave` also
  attaches the source image itself to the Place's `media_list` (alongside
  the overlay file) when saving an image overlay.
- **Unify `SearchOrCreate` with `RecordPicker`'s own "Create X / or / Select
  existing X" layout**: `RefPickerField.tsx`'s `SearchOrCreate` (Event's
  Place field, Citation's Source field, Family's Father/Mother slots) has
  its own older two-button gate ("Select existing…" / "+ New X") before
  opening a `RecordPicker`, so "Select existing…" shows a redundant second
  "(+) Create X" inside the picker. Collapsing it onto the unified layout
  would make every empty reference field in a busy edit form show a full
  search box + results instead of one compact button — worth doing, but as
  its own considered change.
- **Story translations: more languages** — the story player, its
  editors and the Story Editor page (`packages/story`: `player/strings.ts`,
  `editor/translations/`, `site/editorStrings.ts`) have only English,
  German, Spanish, French and Dutch, while the app has ~45. In another app
  language the story editor, map editor tools and Present fall back to
  `t()`, which has almost none of their words, so they're English. Add:
  - **Chinese, Simplified and Traditional** first. Needs a script-aware
    lookup: `editorLanguage`/`stringsFor` key on the base code only, so
    `zh_CN`, `zh-Hans`, `zh-SG` -> Simplified and `zh_TW`, `zh_HK`,
    `zh-Hant`, `zh-MO` -> Traditional.
  - Then Italian, Portuguese (`pt_BR`/`pt_PT` can share one table),
    Russian, Japanese, Polish, Swedish.
  - Each language needs the player's, editor's, map editor's and page's
    tables, plus the app-only words in `app/src/components/story/storyStrings.ts`
    (`APP_WORDS`). Translations are machine-drafted: get a native speaker
    to check them.
