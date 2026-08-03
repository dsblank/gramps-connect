# Gramps Connect

A clean-break prototype for a faster, local-first, real-time-collaborative
Gramps web frontend — built on an extended
[gramps-web-api](https://github.com/gramps-project/gramps-web-api), as a
replacement path for [gramps-web](https://github.com/gramps-project/gramps-web).
See [PLAN.md](PLAN.md) for the full context, the two product bets this is
de-risking (a local-first cache and live multi-user collaboration), and
the layered prototype plan.

This is a multi-month effort still in its early, disposable-prototype
phase — nothing here is a committed architecture yet.

## Layout

- **`layer0-notify-spike/`** — Postgres `LISTEN`/`NOTIFY` change-capture
  spike: proves trigger → `pg_notify` mechanics.
- **`layer1-ws-relay/`** — WebSocket relay spike: proves a Postgres
  notification can reach a browser tab, with fan-out to multiple tabs.
- **`layer2-local-cache/`** — the local-first cache spike: a plain
  TS/HTML client that fetches from gramps-web-api's fast, SQL-pushed-down
  `POST /api/<type>/query/` endpoints (keyset-paginated, `where_expr`
  filtering, `count_of`/`exists`/`count` Collection support), mirrors the
  result into a WASM SQLite table per object type, persists it to OPFS,
  and renders it through a virtualized, scrollable table with a sidebar
  for switching between object types (People, Family, Events, ...).
  `api-fixture/` and `api-fixture-example/` are throwaway, isolated
  gramps-web-api instances used to develop and test the client against —
  the former loaded with `gramps-bench`-generated synthetic data (scale
  testing), the latter with Gramps' own official `example.gramps` sample
  database (real date variety — modifiers, quality, ranges/spans).
- **`packages/gramps-date/`** — a TypeScript port of Gramps' `Date`
  model, calendar conversion, and locale-aware date display, used by the
  Layer 2 client (and anything else that needs to render/build a Gramps
  `Date` struct without a slow per-object round trip through Gramps' own
  Python date displayer). See its own README for scope and provenance.

The fast `/query/` endpoints Layer 2 depends on live in `gramps-web-api`
itself (a separate repo, extended in place, backward compatible) via
[gramps-object-query-language](https://github.com/dsblank/gramps-object-query-language),
not in this repo.

## License

AGPL-3.0-or-later, matching `gramps-web-api` and `gramps-web`. See
[LICENSE](LICENSE). `packages/gramps-date` translates GPL-2.0-or-later
Gramps core code into this project's AGPL-3.0-or-later codebase — see
its own README for how those two licenses combine.
