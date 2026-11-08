# TODO

Open items only. Historical/decision-log content (why React was chosen, how
the sync architecture was de-risked, what's already shipped) used to live in
`PLAN.md`/`ROADMAP.md`/`EDITING-TODO.md`; those are superseded by this file —
see git history for the record if needed.

## CI / build gating

`.github/workflows/ci.yml` now runs on every `push`/`pull_request`: Vitest
(`app/`), `tsc --noEmit`, `packages/gramps-date`'s own test script, and
`npm run build -w app`. `build-docker.yml`/`build-standalone.yml` stay
`workflow_dispatch`-only (registry push / platform-specific runners, not
worth every commit).

- No ESLint/Prettier config exists anywhere in the repo — either add one
  (and lint in CI) or explicitly decide linting is out of scope; don't
  silently skip it.
- Decide whether `deploy/Dockerfile` should also build in CI (would have
  caught several bugs found the first time `deploy/` was built) — likely
  worth it; the build itself is fast now (layers `app/`'s frontend onto the
  official `dmstraub/gramps-webapi` image, no from-source installs), but
  pulling that multi-GB upstream base image on every push may still be
  worth scoping to changes under `deploy/` or `app/` rather than every push.

## Architecture / product

- **Presence layer** (who's viewing/editing what) — deliberately ephemeral,
  in-memory/Redis, kept separate from the durable transaction-history sync
  path. `activeUsers.ts` already ships a client-only stopgap (who's
  recently *edited*, inferred from `historyPoll.ts`'s changed-by field,
  aged out after 5 minutes) — it can't see who's only reading, since
  gramps-web-api has no session/heartbeat/presence concept at all. A real
  presence layer is still open work, not just this approximation.
- **Merge/conflict UX** for genuinely concurrent edits to the same object —
  open design question, not yet resolved. Today a save is blocked with an
  error if the record changed on the server since the dialog opened, so
  nothing is overwritten, but the edit has to be redone. Low priority: two
  people editing the same record at once is rare. (Not the same thing as
  duplicate-record merging, which is fully shipped.)
- Full object-model UI redesign, design system, search-as-navigation — not
  scoped yet.
- **Generations graph (`FamilyGraphView.tsx`) descendant-subtree placement**:
  `DescendantChildrenBox`'s expanded-children row is centered via plain CSS
  (`Stack align="center"`) relative to the *whole* children box's width, not
  anchored to whichever specific child triggered it. When only one child
  (of several) has been expanded and that child sits off-center in a wide
  row, its subtree renders under the row's overall midpoint instead of
  under that child — the connector line still measures/points correctly,
  but visibly stretches a long diagonal to bridge the gap. Fixing this
  properly means switching that subtree row from CSS flow centering to
  measured absolute positioning (same `getBoundingClientRect`-based
  technique the connector lines already use, but setting each subtree's own
  `left` from its trigger's measured center, not just drawing a line to it)
  — needs a `position: relative` container, a measure-then-reposition pass,
  and explicit height reservation since absolutely-positioned children
  don't contribute to their parent's layout height. The ancestor side
  (`SiblingGroupWithAncestry`) doesn't have this bug — each expanded
  sibling-group's own parent-row lives in a `Stack` scoped to just that one
  trigger, with no wider unrelated content sharing its centering context.

## Feature ideas / backlog

Found via a 2026-09-11 sweep across three angles (unused `gramps-web-api`
endpoints, feature-parity vs. `../gramps-web`, unused `/api/metadata/`
fields) — ranked roughly by value, most first:

- **DNA support** — `/people/<handle>/dna/matches`, `/ydna`,
  `/parsers/dna-match` on the API side; `gramps-web` has a match list,
  Y-DNA/lineage view, and chromosome browser (`GrampsjsViewDnaMatches`,
  `GrampsjsViewYDna`, `ChromosomeBrowser.js`). Entirely unexposed in this
  app today — a large, mostly self-contained feature area, not a small add.
- **Photo face-detection / OCR** — `/media/<handle>/face_detection` and
  `/media/<handle>/ocr` are real server-side capabilities with no UI at
  all; would be a differentiating feature for the Media view.
- **Stale-search-index nudge** — `search.sifts.semantic_index_stale` is
  fetched but `ReindexDialog.tsx` only checks the boolean
  `server.semantic_search` flag to decide whether to show a reindex
  checkbox; it never uses the staleness flag to proactively suggest
  reindexing.
- **Research Tasks** — `gramps-web` has a to-do-list feature built as a
  specialized Source subtype with task notes (`GrampsjsViewTask(s)`/
  `NewTask`). No equivalent here beyond plain code comments.

- **Service worker for app-shell caching**: `app/` registers none today, so
  every tab load/reload is a hard dependency on the network being up at that
  exact instant — a laptop resuming from sleep mid-load can hit
  `ERR_NETWORK_CHANGED` on the hashed `index-*.js`/`index-*.css` bundle and
  render a permanently blank page (no JS ever ran, so nothing — not even an
  error boundary — can catch or recover from it; a manual reload fixes it
  once the network's back). `vite-plugin-pwa`/Workbox is the standard fix,
  and is low-effort for basic offline app-shell caching; the real ongoing
  cost is cache invalidation on deploy (get it wrong and users silently get
  stuck on a stale JS bundle until they close every tab).
- Allow gramplets to create objects (a `new()` call; changing and deleting
  already work — see `GRAMPLET_WRITES_PLAN.md`, where creating was left out
  of scope).
- **Gramplet auto-await gaps** (`app/src/pyodidePoc/autoAwait.ts`): a data
  lookup (`get_object()`, `people()`, ...) still fails in a few common
  Python shapes, with errors that only make sense if you know about
  async/await:
  - **Generator expressions** — `any(get_object(...) for h in handles)`
    fails with `TypeError: 'async_generator' object is not an iterator`.
    Fix: when a generator expression gains an `await` and is passed straight
    to `any`/`all`/`sum`/`min`/`max`/`sorted`/`list`/`set`/`tuple`/
    `dict`/`"".join`, rewrite it as a list comprehension (same result; only
    loses early exit, costing extra lookups).
  - **Friendlier error for the rest** — a lookup inside a lambda
    (`sorted(..., key=lambda p: get_object(...))`), a method, a generator
    def, a decorated def, or a def passed around as a value fails with
    `SyntaxError: 'await' outside async function`. Catch that in
    `_run_gramplet()` and say instead, at the same line, that data lookups
    can't happen there — use a regular function called by name, or a list
    comprehension.
- Allow more types of addons: tools, reports.
- Ability to generate PDF forms (add PDF importer).
- Move under gramps-project — would this enable translations?
- **Map overlay → source image back-reference**: an overlay file embeds
  the source image's handle as an app-internal `media-handle:<handle>` fake
  URL (`packages/story/src/mapEdit/mapFile.ts`'s `MEDIA_HANDLE_PREFIX`,
  read back by `app/src/store/kmlMedia.ts`) — one-directional and invisible at the
  Gramps level. It won't show up in a backlink/"referenced by" query, and
  desktop Gramps' remove-unused-objects tool won't know the two are
  related; if the image is later detached from whatever else references it
  (e.g. a Source), the overlay silently breaks with no warning. Cheap fix:
  `MapItemEditorDialog.tsx`'s `handleSave` also attaches the source image
  itself to the Place's `media_list` (alongside the KML) when saving an
  image overlay — makes the relationship visible in the Place's gallery and
  gives it a real Gramps-level reference.
- **Unify `SearchOrCreate` with `RecordPicker`'s own "Create X / or / Select
  existing X" layout**: `RecordPicker.tsx`'s `onCreateNew` path now leads
  with a "(+) Create X" button, an "or" divider, then "Select existing X"
  above the search box — used automatically by every modal-triggered picker
  that passes `onCreateNew` (`AttachControl.tsx`'s Map Overlays case,
  `BulkTagButton.tsx`). `RefPickerField.tsx`'s `SearchOrCreate` (Event's
  Place field, Citation's Source field, Family's Father/Mother slots) still
  has its own separate, older two-button gate ("Select existing…" / "+ New
  X") before ever opening a `RecordPicker` — clicking "Select existing…"
  now shows a redundant second "(+) Create X" inside the picker you just
  opened *from* a button that already offered that. Deliberately left alone
  for now: collapsing `SearchOrCreate` onto the same unified layout would
  mean every empty reference field in a busy edit form (Event/Citation/
  Family) always shows a full search box + results by default instead of a
  single compact button, a real increase in those forms' visual weight —
  worth doing, but as its own considered change, not a side effect of
  another feature.

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

## Editing gaps

Partially editable, by type:
- **Media** — description/date/private editable via `MediaEditButton.tsx`
  (added 2026-09-03); attributes/citations/notes/tags already covered by
  RelatedPanel's own sections. path/mime/checksum stay server-derived from
  the upload, as expected.
- **Person / Family** — LDS ordinances: fully read-only, no edit/add/detach.
- **Place** — enclosing hierarchy (`placeref_list`) is editable by hand in
  `ParentPlacesSection.tsx` (add / insert-between / remove / reorder /
  PlaceRef date; writes in `store/placeHierarchy.ts`) as well as via
  Wikidata lookup. Alternate names (`alt_names`), code and alternate
  locations (`alt_loc`, `PlaceLocationsField.tsx`) are editable in both
  place editors, so every Place field is covered; the map overlay
  feature's date gating still only reads the *primary* name's date.
- **Note** — fully editable: text formatting, links, and the format flag
  (Preformatted switch; `NoteEditor`'s `preformatted` mode).

