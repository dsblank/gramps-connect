---
name: run-app
description: Start gramps-connect's app/ (the React/Vite web client) and its gramps-web-api backend fixture. Use when asked to run, start, or launch the app.
---

`app/` is a browser app (React + Vite) that talks to a `gramps-web-api`
backend over HTTP. Starting it means starting both: the backend fixture
on `:5003`, then the Vite dev server on `:5173`.

All paths below are relative to the repo root.

## Prerequisites

Already satisfied in this container (nothing to install for a normal
session in this checkout):

- Postgres running locally with a `gramps`/`gramps` role and a `gramps`
  database — `dev-fixtures/layer3-sync/api-fixture/config.cfg` hardcodes
  those credentials.
- `gramps` and `gramps_webapi` pip -e installed from `~/gramps/gramps`
  and `~/gramps/gramps-web-api`.
- The fixture's tree already imported (`dev-fixtures/layer3-sync/api-fixture/gramps-home/`
  and `data/users.sqlite` already populated with Gramps' example.gramps
  data, user `gramps`/`gramps`).

If any of those are missing (e.g. a genuinely fresh clone/VM), read
`dev-fixtures/layer3-sync/api-fixture/setup.sh`'s header comment first —
it documents each requirement and **is not idempotent** (re-running it
against an already-populated tree duplicates every object).

## Setup

```bash
npm install                        # workspace install (app/ + packages/gramps-date)
cp app/.env.example app/.env.local # only if app/.env.local doesn't exist yet
```

`app/.env.local`'s only setting, `VITE_API_BASE=http://localhost:5003`,
already points at the fixture backend below.

## Run

**1. Backend** (fixture data already imported — do **not** re-run
`setup.sh`, just start the server it already set up):

```bash
cd dev-fixtures/layer3-sync/api-fixture
export GRAMPSHOME="$PWD/gramps-home"
export GRAMPS_RESOURCES="$HOME/gramps/gramps/build/share"
nohup python3 -m gramps_webapi --config ./config.cfg run -p 5003 > /tmp/api-fixture.log 2>&1 &
disown
timeout 20 bash -c 'until curl -sf -o /dev/null -w "%{http_code}" http://localhost:5003/api/metadata/ | grep -qE "^(200|401)$"; do sleep 1; done'
```

(A `401` from `/api/metadata/` means the server is up — that endpoint
just requires auth.)

**2. Frontend** (from repo root):

```bash
nohup npm run dev -w app > /tmp/vite.log 2>&1 &
disown
timeout 20 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done'
```

**3. Open** `http://localhost:5173` and log in as `gramps` / `gramps`.

Stop both when done:

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
lsof -ti:5003 -sTCP:LISTEN | xargs -r kill
```

## Test

```bash
npm run test -w app         # Vitest: store/sync logic, not full-app rendering
npm run typecheck -w app    # tsc --noEmit
```

## Troubleshooting

- **`curl` to `:5003/api/metadata/` returns connection refused**: the
  `GRAMPSHOME`/`GRAMPS_RESOURCES` env vars weren't exported before
  starting `gramps_webapi`, or you're not in
  `dev-fixtures/layer3-sync/api-fixture/` when you start it (relative
  paths in `config.cfg` resolve from cwd). Check `/tmp/api-fixture.log`.
