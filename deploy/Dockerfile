# syntax=docker/dockerfile:1
#
# Deploy image (deploy/docker-compose.yml and .github/workflows/build-docker.yml
# both build/push this). Layers gramps-connect's frontend onto the official,
# upstream-published gramps-web-api release image (dmstraub/gramps-webapi,
# pushed by .github/workflows/image.yml in gramps-project/gramps-web-api on
# every GitHub release) instead of building gramps-web-api from source --
# mirrors exactly what gramps-project/gramps-web's own Dockerfile does:
# https://github.com/gramps-project/gramps-web/blob/main/Dockerfile
# (`FROM dmstraub/gramps-webapi:latest` + `COPY dist /app/static`).
#
# This replaces the previous from-scratch Dockerfile/Dockerfile.slim pair,
# which built gramps + gramps-web-api from source to control image size and
# work around an editable install's untranslated .mo catalogs. Neither
# problem needs solving here:
#   - SharedPostgreSQL/PostgreSQL/FilterRules/JSON addons and multi-tree
#     support are already present -- gramps-web-base's own Dockerfile.base
#     (the image dmstraub/gramps-webapi builds on) installs those addons.
#   - Translations are already compiled -- gramps-web-api's own Dockerfile
#     installs `gramps[all]` as a normal PyPI wheel (not an editable
#     from-source install), and building a wheel runs build_trans() as a
#     side effect.
#
# Trade-off accepted deliberately: dmstraub/gramps-webapi:latest is built on
# ghcr.io/gramps-project/gramps-web-base (~4.3GB: torch, sentence-transformers,
# opencv, 45 tesseract language packs -- see the removed Dockerfile.slim's
# own comments for the full rationale for avoiding that) and installs the
# `[ai,sentry]` extras unconditionally. There's no official slim variant to
# pull instead, so tracking the upstream image trades image size for not
# hand-maintaining a from-source build of gramps-web-api's own dependencies.

# --- Stage 0: build Pyodide wheels for Gramplets ------------------------
#
# app/scripts/copy-wasm.mjs (run below as `npm ci`'s postinstall) only
# registers gramps-gen-lib/gi/orjson in the built app's
# public/pyodide/pyodide-lock.json when it finds wheels already sitting in
# dist/{gramps-wheel,stub-wheels}/ -- otherwise it silently skips them (see
# its own "best-effort" comment), and every Gramplet calling
# get_object()/get_raw_object()/db.get_*_from_handle() then fails at
# runtime with "No known package with name 'gramps-gen-lib'". This stage
# builds those wheels so Stage 1 below can copy them in before `npm ci`
# runs. Only needs a bare `import gramps` to succeed, so a plain `--no-deps`
# editable install is enough -- gramps-web-api/PyGObject/etc. are not
# needed here.
FROM python:3.13-slim AS gramps-wheels

RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch maintenance/gramps60 \
      https://github.com/gramps-project/gramps /src/gramps && \
    pip install --no-cache-dir -e /src/gramps --no-deps

COPY scripts/build-stub-wheels.py scripts/build-gramps-wheel.py /tmp/
RUN python /tmp/build-stub-wheels.py --out /dist/stub-wheels && \
    python /tmp/build-gramps-wheel.py --out /dist/gramps-wheel --stub-wheels-dir /dist/stub-wheels

# --- Stage 1: build the frontend ---------------------------------------
FROM node:20-slim AS frontend-build

WORKDIR /src

COPY package.json package-lock.json ./
COPY packages ./packages
COPY app ./app
COPY --from=gramps-wheels /dist ./dist

# Frontend and API are served from the same origin in this image (see the
# static-file COPY below), so VITE_API_BASE must stay empty -- app/src/
# config.ts already falls back to "" when unset, but we set it explicitly
# to document the intent.
ENV VITE_API_BASE=""

RUN npm ci
RUN npm run build -w app

# --- Stage 2: layer the frontend onto the official backend image --------
FROM dmstraub/gramps-webapi:latest

COPY --from=frontend-build /src/app/dist /app/static

# deploy/docker-entrypoint.sh is gramps-web-api's own docker-entrypoint.sh
# (baked into the base image) plus: waiting for Postgres to actually accept
# connections (not just for its container to start), skipping migrate/seed
# on the worker service to avoid a concurrent-alembic race, and seeding the
# site admin from GRAMPSWEB_ADMIN_USER/PASSWORD. It runs its migrate step
# from /app/src, matching where the base image's own Dockerfile (`COPY . /app/src`)
# puts the gramps-web-api checkout that alembic.ini lives at the root of.
COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD gunicorn -w ${GUNICORN_NUM_WORKERS:-4} -b 0.0.0.0:5000 \
      gramps_webapi.wsgi:app \
      --timeout ${GUNICORN_TIMEOUT:-120} \
      --limit-request-line 8190
