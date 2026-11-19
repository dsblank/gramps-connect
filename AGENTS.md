# Project rules

- Any change with a user-visible UI/UX effect (a new control, a changed
  flow, new behavior someone would notice while using the app) must also
  update or add to the wiki at `../gramps-connect.wiki/`, on whichever
  topic page already covers that area (`Working-Together.md`,
  `Search-and-Filters.md`, `Charts.md`, `Maps.md`, `Stories-and-Photos.md`,
  `Administration-and-Settings.md`, `Gramplets.md`,
  `Data-Model-and-Editing.md`, `Messaging.md`, `Roadmap.md`, etc.).
  `Overview.md` is only a short tour linking to those pages; touch it only
  for a whole new area. Give each feature its own `###` heading with a few
  short paragraphs, not one long bullet.
  Commit and push the wiki change alongside the code change, not as a
  separate follow-up. A pure refactor, internal fix, or doc-comment change
  with no visible effect doesn't need this.

## Principles

### Every change can be taken back

A shared tree is only safe to open to other people if mistakes can be
undone. Treat reversibility as part of a feature, not a later addition:

- Anything that deletes, merges, or changes many records at once (bulk
  edits, merges, deletes, imports, Gramplet writes, automated fixes such
  as Wikidata lookups) should come with a way to undo it. If it can't yet,
  say so in the plan and add the undo to `TODO.md`. Don't treat "This
  cannot be undone" as finished.
- The server undoes whole transactions, so one user action should be one
  transaction where possible. An action split across many requests can't
  be undone as a unit and leaves a half-done state if it fails partway.
- Make the way back visible where the change happened, for example a
  short Undo notification after a delete or a link from a record's
  History to the change it was part of, instead of expecting people to
  find it later.
- When undoing isn't possible, the confirmation should say exactly what
  will be lost (counts, names), and large irreversible actions need a
  stronger confirmation (the bulk-delete password is the model).

### Two kinds of users

Gramps Connect has two audiences, and features should work for both:

- **Gramps users** expect Gramps' layout, vocabulary, and data model
  (events, citations, references, Gramps IDs). The full editors and list
  views keep that, so the app feels familiar to them.
- **Family members on a hosted tree**, who may never have used Gramps.
  For them, roles decide what they *may* do, but they don't make
  anything easier to *understand*. Where a feature is something a
  relative would do (add a photo, share a memory, correct a date, tag a
  face), design that path in plain words around what they're trying to
  do, without requiring them to understand Gramps' object model first.

Contributions from people (or tools) who shouldn't edit the tree
directly should take the form "suggest, then review": the change is
proposed and an editor accepts, edits, or rejects it. Prefer designs
that keep this possible over ones that only work as direct writes.
When designing a feature, ask how each audience would use it. If it only
makes sense to one of them, that's fine, but decide that on purpose.

## Backend & deployment architecture

- gramps-connect is a pure browser frontend (React/TypeScript) with no
  Python runtime of its own. It talks to gramps-web-api over HTTP; GOQL
  queries compile to SQL and execute inside gramps-web-api's own process,
  against whichever DBAPI backend that server is configured with.
- Two production targets, with different backends: Desktop (the
  standalone build) runs gramps-core's stock SQLite backend; Docker runs
  the `SharedPostgreSQL` addon against a Postgres container.
- Every object is stored as a JSON blob in a `json_data` column, `TEXT`
  on both backends (SharedPostgreSQL creates it as `TEXT` too, not
  `jsonb`). GOQL resolves any dotted field path generically via
  `json_extract` on SQLite and a `::jsonb` cast plus `->` on Postgres, so
  every field on every schema — including deeply nested ones, e.g.
  `birth.date.modifier` — is queryable without per-field wiring. Nothing
  indexes inside `json_data`: filtering or sorting by a path reads and
  parses every row, and a path through another record (`birth.date.sortval`)
  adds a lookup per row. Only the flat secondary columns (`surname`,
  `given_name`, `gramps_id`, ...) are indexed.

## Talking to gramps-web-api

- Every request to gramps-web-api goes through `apiFetch()`
  (`app/src/store/apiFetch.ts`), never plain `fetch()`. It's a drop-in
  replacement (same arguments, same `Response`) and the one place for
  anything that should apply to all API traffic: today a cap on requests
  in flight and automatic retry of `429 Too Many Requests` (the deploy
  stack's Caddy rate limits). Plain `fetch()` is only for non-API URLs
  (Wikidata, GitHub, static `/lang/` or `/pyodide/` files, `blob:` URLs).
  Pass `{ lane: "long" }` as the third argument for a request the server
  works on before replying at all (uploads, synchronous report/export
  generation), so it can't hold up ordinary requests; plain downloads
  don't need it.
- API images shown straight from a URL (`<img src>`, SVG `<image>`, e.g.
  `mediaThumbnailUrl()`) can't go through `apiFetch()`; use
  `useApiImageSrc()` (React) or `retryApiImageOnError()` (D3) from
  `app/src/store/apiImage.ts` so a rate-limited load retries instead of
  showing a broken image.
