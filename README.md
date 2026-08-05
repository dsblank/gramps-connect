# Gramps Connect

An experimental, faster, real-time-collaborative web frontend for
[Gramps](https://gramps-project.org/), the free genealogy software.

## Overview

[Gramps](https://gramps-project.org/) is free, open-source genealogy
software for building and researching your family tree.
[gramps-web](https://github.com/gramps-project/gramps-web) is its
existing web frontend — it lets you access your tree from a browser,
share it with family members, and collaborate on research together.

Gramps Connect is an early-stage experiment exploring what a faster,
more collaborative version of that web frontend could look like. It's
being built alongside gramps-web, not as a finished replacement — the
question this project is trying to answer is *whether* two specific
ideas actually work well in practice, before committing to them:

- **Instant browsing, even on a huge family tree.** Today, searching or
  filtering a large tree (tens of thousands of people) can mean waiting
  a long time — one real example took over a minute and a half for a
  single search. Gramps Connect keeps a smart, local copy of the parts
  of your tree you're looking at, right in your browser, so browsing,
  sorting, and filtering feel instant — closer to searching contacts
  already on your phone than looking someone up over a slow connection.
- **Watching each other work, live.** Family history is often a group
  effort — several people editing the same tree. Gramps Connect aims to
  show you what other researchers are changing as they change it,
  without needing to refresh the page, the same way collaborative
  documents show you a co-author's edits appearing in real time.

**This is a research project, not a product yet.** It isn't something
to move your family tree to today — there's no finished user interface,
no guarantee any particular part of it will end up in a real release,
and the whole thing is still being actively built and re-shaped. If
you're just looking to use Gramps, [gramps-web](https://github.com/gramps-project/gramps-web)
(or the [desktop application](https://gramps-project.org/download/)) is
where you want to be today. If you're curious about where the project
might be headed, or want to help figure that out, read on.

<img width="1349" height="852" alt="image" src="https://github.com/user-attachments/assets/58242257-a619-44e0-8cb8-3576c50677fe" />


## For Developers

### Approach

Rather than rewriting the frontend in one large effort, this project is
being de-risked through small, disposable prototypes — proving each hard
technical question in isolation before committing to it. See
[PLAN.md](PLAN.md) for the full reasoning, the two product bets above in
technical detail, and the layered plan each prototype followed.

The two bets translate to two technical mechanisms:

1. **Local-first cache** — a WASM build of SQLite runs inside the
   browser, mirroring server data (fetched via `gramps-web-api`'s fast,
   SQL-pushed-down `/api/<type>/query/` endpoints) into local tables and
   persisting them to [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
   so a repeat visit skips the network entirely.
2. **Live sync** — the client polls `gramps-web-api`'s existing
   `GET /api/transactions/history/` endpoint (the object-edit audit/undo
   log it already ships) on a short interval, and for each object it
   reports as changed, refetches and patches just that row in the local
   cache. No server changes, persistent connection, or Postgres-specific
   change capture required — a plain authenticated `GET`, so it works
   against any backend.

### Repo layout

- **`app/`** — the production React client (React was chosen over
  gramps-web's Lit/Material Web Components approach — see
  [PLAN.md](PLAN.md)'s roadmap notes for why): all ten object-type views,
  `where_expr` filtering, an OPFS-persisted WASM SQLite cache, and live
  sync, behind a `useSyncExternalStore`-based store layer (`app/src/store/`)
  with `@tanstack/react-virtual` for scrolling. Started as a port of an
  earlier plain-TS/HTML spike (Layers 0-3 in [PLAN.md](PLAN.md)); that
  spike code has since been removed now that `app/` fully supersedes it,
  but the fixtures it's developed and tested against live on in
  `dev-fixtures/` (below).
- **`dev-fixtures/`** — real `gramps-web-api` backends to run `app/`
  against locally (see Getting started below); not part of the product,
  just what makes local development possible without a hand-configured
  server of your own.
  - **`layer2-local-cache/api-fixture/`** and **`api-fixture-example/`** —
    two plain-SQLite instances: the former loaded with
    `gramps-bench`-generated synthetic data (scale testing), the latter
    with Gramps' own official `example.gramps` sample database (real date
    variety — modifiers, quality, ranges/spans). Live sync works against
    either of these too now — it's just a poll against
    `/api/transactions/history/`, not tied to Postgres.
  - **`layer3-sync/`** — a real Postgres (`SharedPostgreSQL`)-backed
    instance, useful for exercising genuinely concurrent multi-writer
    edits against the same tree; what `app/.env.example`'s defaults point
    at. No longer has any Postgres-specific change-capture wiring of its
    own (the `pg_notify` trigger + WebSocket relay this fixture used to
    also set up were removed once live sync moved to polling — see
    PLAN.md's Layer 3 section).
- **`packages/gramps-date/`** — a TypeScript port of Gramps' `Date`
  model, calendar conversion, and locale-aware date display, used by
  `app/` (and anything else that needs to render/build a Gramps `Date`
  struct without a slow per-object round trip through Gramps' own Python
  date displayer). See its own README for scope and provenance.

A root-level npm workspace (`packages/*`, `app`) ties `app/` and
`packages/gramps-date` together as real workspace dependencies. The
fast `/query/` endpoints `app/` depends on live in `gramps-web-api`
itself (a separate repo, extended in place, backward compatible) via
[gramps-object-query-language](https://github.com/dsblank/gramps-object-query-language),
not in this repo.

### Getting started

```sh
npm install                 # installs the workspace (app/ + packages/gramps-date)
cp app/.env.example app/.env.local   # points at a running gramps-web-api instance
npm run dev -w app          # starts the Vite dev server
```

`app/` needs a real `gramps-web-api` backend to talk to — the quickest
way to get one locally is `dev-fixtures/layer3-sync/api-fixture/setup.sh`,
which stands up a Postgres-backed instance with example data;
`app/.env.example`'s defaults already point at it. **Read the script
before running it** — it is not idempotent against an already-populated
tree.

### Testing

```sh
npm run test -w app         # Vitest: pure store/sync logic, not full-app rendering
npm run typecheck -w app    # tsc --noEmit
npm run test -w packages/gramps-date
```

### Contributing

This is still a fast-moving, early-stage prototype — expect things to
be restructured or thrown out as the layered plan in [PLAN.md](PLAN.md)
teaches us more. Discussion happens on the
[Gramps Discourse forum](https://gramps.discourse.group/) (see
[this thread](https://gramps.discourse.group/t/gramps-web-api-list-performance/9007)
for the performance problem that originally motivated this project);
issues and pull requests against this repo are welcome, especially ones
that engage with the reasoning in PLAN.md rather than just the code.

## License

AGPL-3.0-or-later, matching `gramps-web-api` and `gramps-web`. See
[LICENSE](LICENSE). `packages/gramps-date` translates GPL-2.0-or-later
Gramps core code into this project's AGPL-3.0-or-later codebase — see
its own README for how those two licenses combine.
