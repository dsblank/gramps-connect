# Production readiness roadmap

Tracks what's needed to run gramps-connect on a real server, as distinct
from `PLAN.md` (the sync-architecture spike plan) and `standalone/` (a
single-user desktop demo, not a server deployment). See `deploy/README.md`
for operational docs on what's already built.

## Done

- **Containerize frontend + backend with real config/secrets** — `deploy/`
  (Dockerfile, docker-compose.yml, docker-entrypoint.sh): `app` (gunicorn,
  serves the built frontend + `/api/*` from one origin), `worker` (Celery,
  for import/media/search-reindex jobs), `postgres` (tree data via the
  `SharedPostgreSQL` addon), `redis` (Celery broker). No hardcoded
  secrets/admin credentials — real values via `deploy/.env` (gitignored).
- **TLS / reverse proxy** — `deploy/Caddyfile`: `caddy` is the sole
  published entrypoint (80/443); `app` no longer publishes a port directly.
  Self-signed cert via Caddy's internal CA for now (no domain configured
  yet); documented one-block swap to real Let's Encrypt certs once a
  domain exists.

## Next: CI build/test gating

The only workflow today, `.github/workflows/build-standalone.yml`, is
`workflow_dispatch`-only (manual trigger) and builds the PyInstaller demo
binary — it doesn't run on push/PR, and doesn't run the test suite,
typecheck, or any lint step. So a broken commit merges to `main` with
nothing catching it; the existing tests only ever get run by whoever
remembers to run them locally.

Needed:
- A new workflow triggered on `push`/`pull_request` (not manual-only, so
  it actually gates merges) that runs, at minimum:
  - `npm run test -w app` (Vitest — store/sync logic, per `README.md`'s
    Testing section)
  - `npm run typecheck -w app` (`tsc --noEmit`)
  - `packages/gramps-date`'s own test script (`tsx --test src/__tests__/*.test.ts`)
  - `npm run build -w app` (catches build-only failures typecheck/tests miss)
- No ESLint/Prettier config exists anywhere in the repo yet — either add
  one (and lint in CI) or explicitly decide linting is out of scope for
  now; don't silently skip it.
- Decide whether `deploy/Dockerfile` should also build in CI (catches
  Dockerfile/dependency-list drift before it's discovered in production —
  several of the bugs found while building `deploy/` the first time, e.g.
  the missing `git` package, would have been caught by this) — likely
  worth it, but it's a slower job (multi-GB base image, from-source
  installs of `gramps`/`gramps-web-api`) so may want its own trigger
  scope (e.g. only on changes under `deploy/` or `app/`) rather than
  running on every push.
- `build-standalone.yml` stays manual-trigger (Windows/macOS PyInstaller
  builds aren't needed on every commit) — this is a separate, additive
  workflow, not a replacement.
