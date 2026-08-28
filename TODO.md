# TODO

Open items only. Historical/decision-log content (why React was chosen, how
the sync architecture was de-risked, what's already shipped) used to live in
`PLAN.md`/`ROADMAP.md`/`EDITING-TODO.md`; those are superseded by this file —
see git history for the record if needed.

## CI / build gating

The only workflows today (`build-docker.yml`, `build-standalone.yml`) are
`workflow_dispatch`-only — nothing runs on push/PR, so a broken commit merges
to `main` with nothing catching it.

- Add a workflow triggered on `push`/`pull_request` that runs at minimum:
  - `npm run test -w app` (Vitest — store/sync logic)
  - `npm run typecheck -w app` (`tsc --noEmit`)
  - `packages/gramps-date`'s own test script (`tsx --test src/__tests__/*.test.ts`)
  - `npm run build -w app` (catches build-only failures typecheck/tests miss)
- No ESLint/Prettier config exists anywhere in the repo — either add one
  (and lint in CI) or explicitly decide linting is out of scope; don't
  silently skip it.
- Decide whether `deploy/Dockerfile`/`Dockerfile.slim` should also build in
  CI (would have caught several bugs found the first time `deploy/` was
  built, e.g. a missing `git` package) — likely worth it, but it's a slow
  job (multi-GB base image, from-source `gramps`/`gramps-web-api` installs),
  so probably wants its own trigger scope (e.g. only on changes under
  `deploy/` or `app/`) rather than running on every push.

## Architecture / product

- **Presence layer** (who's viewing/editing what) — deliberately ephemeral,
  in-memory/Redis, kept separate from the durable transaction-history sync
  path.
- **Auth/permissions**: `app/` has a minimal login form (real credentials,
  no hardcoding) but no refresh-token rotation or expiry handling yet.
  gramps-web's own `Auth` class (`~/gramps/gramps-web/src/api.js`) is the
  reference to build against.
- **Merge/conflict UX** for genuinely concurrent edits to the same object —
  open design question, not yet resolved.
- **gramps-web-api filter pushdown**: `GrampsObjectsResource.get()`
  (`gramps_webapi/api/resources/base.py:589-615`) still unconditionally
  loads every object via `iter_objects_method()` before applying
  `filter`/`rules`/`gql`/`oql` — the same discourse-thread perf bug as
  originally documented (104s for a filtered query on 100k people).
  Note: a newer `ObjectQueryResource` endpoint (gramps-web-api commit
  `699d045`) added real SQL pushdown via a different code path — check
  whether `app/` switching to that endpoint already supersedes fixing
  `GrampsObjectsResource.get()` before doing more work here.
- Full object-model UI redesign, design system, search-as-navigation — not
  scoped yet.

## Feature ideas / backlog

- Design and write `st.columns()` (Pyodide addon Gramplet API layout helper).
- Allow gramplets to edit/create objects (currently read-only via
  `filter()`/`get_object()`).
- Allow more types of addons: tools, reports.
- Ability to generate PDF forms (add PDF importer).
- Move under gramps-project — would this enable translations?
- Add recently visited items.
- Add history of changes per object (once available in gramps-web-api).

## Editing gaps

Not editable at all:
- **Media** — no edit dialog exists at all; desc/tags only change via the
  narrow internal report-promotion path (`jobsApi.ts`'s
  `tagAndDescribeMedia`), not a user-facing Edit button.

Partially editable, by type:
- **Person / Family** — LDS ordinances: fully read-only, no edit/add/detach.
- **Place** — missing: enclosing/parent place hierarchy, alternate names,
  historical locations, code, name's own language/date.
- **Source** — missing: repository links (can't attach a Source to where
  it's held).
- **Note** — missing: text formatting/links (plain text only), format
  (Flowed/Formatted).

Cross-cutting:
- No merge tooling for duplicate records — the single biggest remaining
  structural gap.
- GrampsType fields are free text, not dropdowns (Family's relationship
  type, and Attribute/Url's own `type`, are the exceptions with a real
  dropdown) — functionally editable, just no autocomplete/validation
  against the known list.
