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

## Feature ideas / backlog

Roughly by value, most first:

- **DNA support** — `/people/<handle>/dna/matches`, `/ydna`,
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
