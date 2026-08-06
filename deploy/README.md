# Server deployment

Containerized `app/` (frontend) + `gramps-web-api` (backend), backed by
Postgres via the `SharedPostgreSQL` addon, for running gramps-connect on a
real server. This is step 1 of production readiness: real (non-hardcoded)
config and secrets, running in Docker. **Not covered here**, and tracked as
separate follow-up work: TLS/reverse-proxy in front of this, and CI
build/test gating.

Frontend and backend share one container/origin (`gramps_webapi` serves the
built SPA via `STATIC_PATH` and handles `/api/*` in the same process), so
there's no CORS configuration and no second frontend image.

Services: `app` (gunicorn, serves the frontend + `/api/*`), `worker`
(Celery, runs import/media/search-reindex jobs), `postgres` (tree data via
SharedPostgreSQL), `redis` (Celery broker).

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

# Status of all four services
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
TOKEN=$(curl -s -X POST http://localhost:5000/api/token/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"<admin>","password":"<admin password>"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

TREE_ID=$(curl -s -X POST http://localhost:5000/api/trees/ \
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
curl -s -X PUT "http://localhost:5000/api/users/<admin>/" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"tree\":\"$TREE_ID\"}"

# Option B: create a separate regular user tied to the tree instead.
# email and full_name are required by the schema even if unused.
curl -s -X POST "http://localhost:5000/api/users/<username>/" \
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

Then log in at `http://localhost:5000/` as whichever user you just created
— existing tokens issued before a tree assignment won't carry it, so log
out/in again if you reused an already-open session.

## Importing data (e.g. `example.gramps`, with media)

```sh
TOKEN=$(curl -s -X POST http://localhost:5000/api/token/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"<owner>","password":"<password>"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 1. Import the .gramps XML file. IMPORTANT: this endpoint reads the raw
#    request body and writes it straight to disk -- it does NOT parse
#    multipart/form-data, so use --data-binary, not curl's -F/--form (a
#    multipart upload silently corrupts the file with boundary/header
#    bytes, and Gramps' importer then fails with a generic, unhelpful
#    "Import failed" and no further detail).
curl -s -X POST http://localhost:5000/api/importers/gramps/file \
  -H "Authorization: Bearer $TOKEN" --data-binary @example.gramps

# Response is a task handle (import runs on the `worker` service via
# Celery) -- poll it until "state":"SUCCESS" (or "FAILURE"):
curl -s http://localhost:5000/api/tasks/<task_id> -H "Authorization: Bearer $TOKEN"

# 2. Media: zip up the referenced media files (any subset/superset is fine
#    -- files are matched by checksum, unreferenced ones are ignored) and
#    upload the archive, again as a raw body:
curl -s -X POST http://localhost:5000/api/media/archive/upload/zip \
  -H "Authorization: Bearer $TOKEN" --data-binary @media.zip

# 3. Verify: object counts for the logged-in user's tree.
curl -s http://localhost:5000/api/metadata/ -H "Authorization: Bearer $TOKEN" \
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

## Notes

- Data persists in named Docker volumes (`app-db`, `app-media`,
  `app-indexdir`, `app-users`, `app-secret`, `app-cache`, `postgres-data`).
  `docker compose down` (without `-v`) keeps them; `docker compose down -v`
  deletes everything.
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
- The backend is built from `dsblank/gramps-web-api@feat/object-query-endpoints`
  and `gramps-project/gramps@maintenance/gramps60` from source, not from a
  pre-built image, because the query-language endpoints this project depends
  on ([PR #913](https://github.com/gramps-project/gramps-web-api/pull/913))
  aren't merged upstream yet. See `deploy/Dockerfile` for details.
- `app/`'s browser-side local cache (sql.js, OPFS) is keyed by a fixed
  filename per view, not by backend URL or tree ID — switching
  `VITE_API_BASE`, or re-importing/recreating a tree against the same
  backend, can leave a browser profile serving stale cached rows with no
  automatic invalidation (the only check is schema compatibility, not
  data identity). Clear it manually if data looks stale: DevTools →
  Application → Storage → clear site data (or OPFS specifically).
