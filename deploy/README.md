# Server deployment

Containerized `app/` (frontend) + `gramps-web-api` (backend), backed by
Postgres via the `SharedPostgreSQL` addon, fronted by Caddy for TLS, for
running gramps-connect on a real server. Real (non-hardcoded) config and
secrets throughout. **Not covered here**, and tracked as separate
follow-up work: CI build/test gating.

The backend is the official, unmodified `dmstraub/gramps-webapi` image
(the one `gramps-project/gramps-web-api`'s own CI publishes on every
release, and the same one `gramps-project/gramps-web` itself builds on --
see `deploy/Dockerfile`), not a from-source build we maintain. That keeps
this deployment a plain, standard gramps-web-api instance any compatible
client can talk to -- not just gramps-connect's own frontend. A
separately-hosted gramps-web (or other) frontend can point at this
backend's `/api/` too; set `GRAMPSWEB_CORS_ORIGINS` in `deploy/.env` to
allow its origin (see `.env.example`).

Frontend and backend share one container/origin by default (`gramps_webapi`
serves the built SPA via `STATIC_PATH` and handles `/api/*` in the same
process), so gramps-connect itself needs no CORS configuration -- that's
only relevant for a *different*, separately-hosted frontend calling in.

Services: `caddy` (TLS termination, the only published entrypoint), `app`
(gunicorn, serves the frontend + `/api/*`), `worker` (Celery, runs
import/media/search-reindex jobs), `postgres` (tree data via
SharedPostgreSQL), `redis` (Celery broker).

## Running gramps-web alongside gramps-connect

Not wired up here (no `grampsweb` service in `docker-compose.yml` yet), but
worth knowing: since the backend is a plain, unmodified gramps-web-api
instance, `gramps-project/gramps-web` (the other official frontend) can run
against this same backend too -- same data, same trees/users, just a
different UI on a different port.

`gramps-web` publishes `ghcr.io/gramps-project/grampsjs:latest` for exactly
this: nginx serving its static build only, no backend baked in
(`Dockerfile.nginx` in that repo). Its nginx config
(`default.conf.template`) reverse-proxies `/api` to an `API_HOST` env var
at container startup, so from the browser's perspective it's same-origin --
no `GRAMPSWEB_CORS_ORIGINS` needed for this path specifically (that's for a
gramps-web instance hosted somewhere else entirely, calling in cross-origin
instead of through this proxy).

To add it, a `docker-compose.yml` service along these lines:

```yaml
grampsweb:
  image: ghcr.io/gramps-project/grampsjs:latest
  environment:
    API_HOST: http://app:5000
    # Docker's embedded DNS resolver -- default.conf.template's `resolver`
    # directive requires this to be set explicitly.
    NAME_SERVER: 127.0.0.11
  depends_on:
    - app
  restart: unless-stopped
```

published on its own port (either directly, e.g. `ports: ["8081:80"]`, or
fronted by Caddy with a second `:8443 { reverse_proxy grampsweb:80 }`-style
block in `deploy/Caddyfile` for TLS to match the `app` service).

## Docker commands

All commands below assume you're in the repo root. `docker compose` is the
plugin form; if your Docker install only has the standalone binary, use
`docker-compose` instead (same flags either way) — that's what this
session's environment needed.

```sh
# First time: copy and edit the env file (see below), then build + start
# everything, in the background.
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build

# Status of all five services
docker compose -f deploy/docker-compose.yml ps

# Logs (add -f to follow, --tail=100 to limit)
docker compose -f deploy/docker-compose.yml logs app
docker compose -f deploy/docker-compose.yml logs worker

# Restart one service (e.g. after an env change in deploy/.env)
docker compose -f deploy/docker-compose.yml up -d
# ^ recreates any service whose config (image, env, volumes) changed;
#   add --build first if you edited deploy/Dockerfile or app/backend source.

# Stop everything, keep data (volumes survive)
docker compose -f deploy/docker-compose.yml down

# Stop and delete all data (careful -- drops Postgres, media, users, etc.)
docker compose -f deploy/docker-compose.yml down -v

# Shell into a running container (e.g. to inspect files, per the media
# directory gotcha below)
docker compose -f deploy/docker-compose.yml exec app sh
```

### Login credentials: this deploy vs. the standalone build

This docker deploy has **no default password** — you set
`GRAMPSWEB_ADMIN_USER`/`GRAMPSWEB_ADMIN_PASSWORD` yourself in `deploy/.env`
before first boot (see below), and that's what the entrypoint seeds. Nothing
generates or prints a password for you.

That's different from `standalone/` (the single-user PyInstaller demo build,
unrelated to this docker deploy): it always seeds a fixed `admin`/`admin`
account (`standalone/launcher.py`), which is fine there since it's a
throwaway local demo, not something exposed on a real server.

## First-time setup: the seeded admin

On first boot (first time the `app-users`/`app-db` volumes are empty), the
entrypoint:
- generates and persists a Flask secret key if `GRAMPSWEB_SECRET_KEY` was left blank
- runs user-database migrations
- seeds a **site admin** user (treeless, role 5) from `GRAMPSWEB_ADMIN_USER` /
  `GRAMPSWEB_ADMIN_PASSWORD` (both required in `deploy/.env` — no
  `admin`/`admin` fallback)

A treeless site admin can create/list/delete trees via the API, but — since
`app/`'s frontend has no tree-selection UI and always expects the logged-in
user's JWT to already carry a tree — **cannot browse a tree's data until
assigned to one**. There's no CLI command for tree creation in multi-tree
mode, so create the first tree via the API (one-time):

```sh
TOKEN=$(curl -sk -X POST https://localhost/api/token/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"<admin>","password":"<admin password>"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

TREE_ID=$(curl -sk -X POST https://localhost/api/trees/ \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"My Family Tree"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

echo "$TREE_ID"
```

Then either assign the site admin itself to that tree, or (recommended —
keeps site administration and tree ownership separate) create a dedicated
tree-scoped user:

```sh
# Option A: assign the existing site admin to the tree.
curl -sk -X PUT "https://localhost/api/users/<admin>/" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"tree\":\"$TREE_ID\"}"

# Option B: create a separate regular user tied to the tree instead.
# email and full_name are required by the schema even if unused.
curl -sk -X POST "https://localhost/api/users/<username>/" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"email\":\"<email>\",\"full_name\":\"<full name>\",\"password\":\"<password>\",\"role\":4,\"tree\":\"$TREE_ID\"}"
```

`role` is an integer (`gramps_webapi.auth.const`):

| Role        | Value | Notes                                              |
|-------------|-------|-----------------------------------------------------|
| ADMIN       | 5     | Site admin; only role allowed to be treeless        |
| OWNER       | 4     | Full control of their tree                          |
| EDITOR      | 3     | Can edit tree data                                  |
| CONTRIBUTOR | 2     | Can add data                                         |
| MEMBER      | 1     | Read access                                          |
| GUEST       | 0     | Minimal read access                                  |

Then log in at `https://localhost/` as whichever user you just created
— existing tokens issued before a tree assignment won't carry it, so log
out/in again if you reused an already-open session.

## Importing data (e.g. `example.gramps`, with media)

```sh
TOKEN=$(curl -sk -X POST https://localhost/api/token/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"<owner>","password":"<password>"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 1. Import the .gramps XML file. IMPORTANT: this endpoint reads the raw
#    request body and writes it straight to disk -- it does NOT parse
#    multipart/form-data, so use --data-binary, not curl's -F/--form (a
#    multipart upload silently corrupts the file with boundary/header
#    bytes, and Gramps' importer then fails with a generic, unhelpful
#    "Import failed" and no further detail).
curl -sk -X POST https://localhost/api/importers/gramps/file \
  -H "Authorization: Bearer $TOKEN" --data-binary @example.gramps

# Response is a task handle (import runs on the `worker` service via
# Celery) -- poll it until "state":"SUCCESS" (or "FAILURE"):
curl -sk https://localhost/api/tasks/<task_id> -H "Authorization: Bearer $TOKEN"

# 2. Media: zip up the referenced media files (any subset/superset is fine
#    -- files are matched by checksum, unreferenced ones are ignored) and
#    upload the archive, again as a raw body:
curl -sk -X POST https://localhost/api/media/archive/upload/zip \
  -H "Authorization: Bearer $TOKEN" --data-binary @media.zip

# 3. Verify: object counts for the logged-in user's tree.
curl -sk https://localhost/api/metadata/ -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

**Known gotcha**: with `GRAMPSWEB_MEDIA_PREFIX_TREE=True` (set by default in
this compose file -- see Notes below), media is stored under
`MEDIA_BASE_DIR/<tree_id>/`, but nothing creates that per-tree subdirectory
automatically -- neither `POST /api/trees/` nor the media-archive-upload
task. Uploading media for a tree fails with `Directory
/app/media/<tree_id> does not exist` until it's created once, e.g.:

```sh
docker compose -f deploy/docker-compose.yml exec app mkdir -p /app/media/<tree_id>
```

## TLS

`caddy` is the only service with published ports (80/443) and terminates
TLS in front of `app`. With no domain configured, it generates and
persists its own local CA and issues a self-signed certificate from it
automatically (`deploy/Caddyfile`'s `tls internal`) — browsers will show a
trust warning the first time; accept it to proceed (or add the generated
CA to your system/browser trust store if you want the warning gone without
a real domain). Port 80 redirects to 443.

**Once a real domain points at this server**, edit `deploy/Caddyfile`:
replace the `:443 { tls internal ... }` block with `example.com {
reverse_proxy app:5000 }` and delete the `:80` block — Caddy handles ACME
issuance, renewal, and the port-80 redirect automatically for a real
domain, no `tls` directive needed. Also update `PUBLIC_URL` in
`deploy/.env` to the real `https://` domain, then `docker compose -f
deploy/docker-compose.yml up -d` to pick up both changes.

## Notes

- Data persists in named Docker volumes (`app-db`, `app-media`,
  `app-indexdir`, `app-users`, `app-secret`, `app-cache`, `app-tmp`,
  `postgres-data`, `caddy-data`, `caddy-config`). `docker compose down`
  (without `-v`) keeps them; `docker compose down -v` deletes everything
  (including the
  generated CA — that's a new browser trust warning next boot, not just
  data loss).
- `redis` (Celery broker/result backend) is required for background tasks
  (search indexing, large import/export jobs) — not optional. So is the
  `worker` service: import, media-archive-upload, and search reindexing all
  dispatch through Celery once `GRAMPSWEB_CELERY_CONFIG__*` is set, and sit
  forever as an unfulfilled task without something consuming the queue.
  `app-cache` (`/app/cache`) must be a volume shared between `app` and
  `worker` for the same reason: the app container's request handler writes
  the uploaded file there, then the worker container's Celery task reads it
  back.
- The `worker` service runs with `--pool=solo` (no forking). This was added
  while debugging the "Import failed" symptom above and turned out not to
  be the actual cause (the multipart-upload bug was), but is left in place
  since Celery's default prefork pool forking a process that has already
  touched real PyGObject/GTK state (Gramps' `gi.repository.GLib` import,
  see the Dockerfile) is a plausible source of subtle fork-safety bugs, and
  a single worker instance doesn't need the concurrency `--pool=solo`
  gives up. Revisit if worker throughput becomes a bottleneck.
- The backend is `dmstraub/gramps-webapi:latest` (see `deploy/Dockerfile`'s
  own comments) — the official image `gramps-project/gramps-web-api`'s CI
  publishes on every release. SharedPostgreSQL/PostgreSQL/FilterRules/JSON
  addons, multi-tree support, and compiled translations all come from that
  image already; the only thing this repo's build adds is `app/`'s
  frontend, layered on top as static files. Trade-off: that upstream image
  is built on `gramps-web-base` (~4.3GB — torch, sentence-transformers,
  opencv, 45 tesseract language packs) with the AI extras installed
  unconditionally, since there's no official slim variant to pull instead.
- `.github/workflows/build-docker.yml` (manual trigger — `gh workflow run
  build-docker.yml`, or the Actions tab) builds `deploy/Dockerfile` and
  pushes `ghcr.io/<owner>/gramps-connect:latest`.
  `docker compose -f deploy/docker-compose.yml --env-file deploy/.env pull`
  grabs that instead of building locally; `up -d --build` (as in the Docker
  commands above) remains there for local iteration on the Dockerfile
  itself.
- `app/`'s browser-side local cache (sql.js, OPFS) is keyed by a fixed
  filename per view, not by backend URL or tree ID — switching
  `VITE_API_BASE`, or re-importing/recreating a tree against the same
  backend, can leave a browser profile serving stale cached rows with no
  automatic invalidation (the only check is schema compatibility, not
  data identity). Clear it manually if data looks stale: DevTools →
  Application → Storage → clear site data (or OPFS specifically).
