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
- **Auth/permissions**: `app/` has a minimal login form (real credentials,
  no hardcoding) but no refresh-token rotation or expiry handling yet.
  gramps-web's own `Auth` class (`~/gramps/gramps-web/src/api.js`) is the
  reference to build against. (Being addressed at the `gramps-web-api`
  level, not `app/`.)
- **Merge/conflict UX** for genuinely concurrent edits to the same object —
  open design question, not yet resolved. (Not the same thing as
  duplicate-record merging, which is fully shipped — see "Editing gaps"
  below.)
- **gramps-web-api filter pushdown**: `GrampsObjectsResource.get()`
  (`gramps_webapi/api/resources/base.py:589-615`) still unconditionally
  loads every object via `iter_objects_method()` before applying
  `filter`/`rules`/`gql`/`oql` — the same discourse-thread perf bug as
  originally documented (104s for a filtered query on 100k people).
  Confirmed 2026-09-11: **not** superseded by switching to
  `ObjectQueryResource` — `app/` still hits this exact vulnerable endpoint
  today, via `treeData.ts`'s `GET /api/people/?rules=...`
  (`IsLessThanNthGenerationAncestorOf`/`DescendantOf`), which backs the
  Tree/fan chart's ancestor/descendant loading and per-node lazy-expand.
  Every other view already reads through `/query/`'s real SQL pushdown —
  this rules-based endpoint is the one path left that doesn't.
- Full object-model UI redesign, design system, search-as-navigation — not
  scoped yet.

## Feature ideas / backlog

Found via a 2026-09-11 sweep across three angles (unused `gramps-web-api`
endpoints, feature-parity vs. `../gramps-web`, unused `/api/metadata/`
fields) — ranked roughly by value, most first:

- **DNA support** — `/people/<handle>/dna/matches`, `/ydna`,
  `/parsers/dna-match` on the API side; `gramps-web` has a match list,
  Y-DNA/lineage view, and chromosome browser (`GrampsjsViewDnaMatches`,
  `GrampsjsViewYDna`, `ChromosomeBrowser.js`). Entirely unexposed in this
  app today — a large, mostly self-contained feature area, not a small add.
- **Relationship-path chart** — "how are these two specific people
  related" (shortest path between them), distinct from `TreeView.tsx`'s
  existing ancestor/descendant tree. `gramps-web`'s
  `GrampsjsViewRelationshipChart`/`charts/RelationshipChart.js` is the
  reference.
- **Photo face-detection / OCR** — `/media/<handle>/face_detection` and
  `/media/<handle>/ocr` are real server-side capabilities with no UI at
  all; would be a differentiating feature for the Media view.
- **Bookmarks** — `/bookmarks/` is a ready-built per-type bookmark list,
  unused. Simpler and faster to ship than "add recently visited items"
  (below), which it's adjacent to but not a replacement for.
- **Anniversaries / upcoming dates** — `/anniversaries.ics` gives an iCal
  feed of upcoming birthdays/anniversaries for free; `gramps-web`'s
  `GrampsjsViewAnniversaries` is the equivalent view. `HomeView.tsx`'s
  stats only cover *recently* changed, not *upcoming* dates.
- **Researcher / tree-owner info** — `/api/metadata/researcher/` (name,
  address, email, phone) has full GET+PUT support server-side and zero UI.
  This is the info GEDCOM export headers (SOUR/SUBM) conventionally carry —
  a "Tree info" settings panel is a plausible small, real feature.
- **Tree summary stats on Home/About** — `object_counts` (people/families/
  events/... counts) is already fetched and typed in `metadataApi.ts` but
  never rendered anywhere. Side finding: that file's own comment claims
  `cacheMeta.ts` reads `object_counts` for staleness detection — it
  doesn't (no match on grep) — fix the stale comment regardless of whether
  the stats UI gets built.
- **Stale-search-index nudge** — `search.sifts.semantic_index_stale` is
  fetched but `ReindexDialog.tsx` only checks the boolean
  `server.semantic_search` flag to decide whether to show a reindex
  checkbox; it never uses the staleness flag to proactively suggest
  reindexing.
- **Research Tasks** — `gramps-web` has a to-do-list feature built as a
  specialized Source subtype with task notes (`GrampsjsViewTask(s)`/
  `NewTask`). No equivalent here beyond plain code comments.
- **Personal API tokens** — `/users/-/access-tokens/<scope>/` is unused;
  relevant if bot/script integrations in the `scripts/echo_bot.py` style
  are a direction worth leaning into (auth without sharing a real user's
  password).

- Allow gramplets to edit/create objects (currently read-only via
  `filter()`/`get_object()`).
- Allow more types of addons: tools, reports.
- Ability to generate PDF forms (add PDF importer).
- Move under gramps-project — would this enable translations?
- Add recently visited items.
- Add history of changes per object (once available in gramps-web-api).
- **KML overlay → source image back-reference**: a KML GroundOverlay embeds
  the source image's handle as an app-internal `media-handle:<handle>` fake
  URL (`kmlWrite.ts`/`kmlMedia.ts`) — one-directional and invisible at the
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

## Editing gaps

Partially editable, by type:
- **Media** — description/date/private editable via `MediaEditButton.tsx`
  (added 2026-09-03); attributes/citations/notes/tags already covered by
  RelatedPanel's own sections. path/mime/checksum stay server-derived from
  the upload, as expected.
- **Person / Family** — LDS ordinances: fully read-only, no edit/add/detach.
- **Place** — enclosing/parent hierarchy (`placeref_list`) can now be set,
  but only indirectly via Wikidata lookup's Apply (`PlaceEditDialog.tsx`);
  `ParentPlacesSection.tsx` (RelatedPanel) only displays it, read-only —
  still no manual add/remove/edit UI for a place's own enclosing places.
  Also still missing: **alternate names** (add/edit/remove — a Place's
  `alt_names` list is displayed read-only in RelatedPanel but has no editor;
  each entry is its own `PlaceName` with its own `value`/`date`/`lang`, e.g.
  for recording a place's older name and the era it applied — the map
  overlay feature's date gating currently only reads the *primary* name's
  date for exactly this reason), historical locations, code.
- **Note** — missing: text formatting/links (plain text only), format
  (Flowed/Formatted).

Cross-cutting:
- GrampsType fields are free text, not dropdowns (Family's relationship
  type, and Attribute/Url's own `type`, are the exceptions with a real
  dropdown) — functionally editable, just no autocomplete/validation
  against the known list. The fix is sitting unused: gramps-web-api's
  `/types/` endpoint (custom + default type lists) is never called from
  `app/` anywhere.
