# Project rules

- Any change with a user-visible UI/UX effect (a new control, a changed
  flow, new behavior someone would notice while using the app) must also
  update or add to the wiki at `../gramps-connect.wiki/` — usually
  `Overview.md`'s feature list, but use whichever page already covers that
  area (`Data-Model-and-Editing.md`, `Messaging.md`, `Roadmap.md`, etc.).
  Commit and push the wiki change alongside the code change, not as a
  separate follow-up. A pure refactor, internal fix, or doc-comment change
  with no visible effect doesn't need this.

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
