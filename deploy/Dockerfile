# syntax=docker/dockerfile:1
#
# Full-featured deploy image, including the AI/CV stack (torch,
# sentence-transformers, opencv, tesseract) for gramps-web-api's
# semantic-search/chat and OCR features. deploy/docker-compose.yml and
# .github/workflows/build-docker.yml build deploy/Dockerfile.slim by
# default instead, since this deployment doesn't enable any of that --
# see deploy/Dockerfile.slim for why. Kept around for anyone who does
# want those features.

# --- Stage 1: build the frontend ---------------------------------------
FROM node:20-slim AS frontend-build

WORKDIR /src

COPY package.json package-lock.json ./
COPY packages ./packages
COPY app ./app

# Frontend and API are served from the same origin in this image (see
# STATIC_PATH below), so VITE_API_BASE must stay empty -- app/src/config.ts
# already falls back to "" when unset, but we set it explicitly to document
# the intent, matching .github/workflows/build-standalone.yml.
ENV VITE_API_BASE=""

RUN npm ci
RUN npm run build -w app

# --- Stage 2: backend + baked-in frontend --------------------------------
#
# gramps-web-base only installs system packages and Gramps addons (incl.
# SharedPostgreSQL) from Dockerfile.base -- it never installs the
# gramps_webapi Python package itself (see .github/workflows/base-image.yml
# in the gramps-web-api repo), so we install gramps and gramps-web-api from
# source below.
FROM ghcr.io/gramps-project/gramps-web-base:latest AS backend

WORKDIR /app

# gramps-web-base's Dockerfile.base doesn't install git.
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch maintenance/gramps60 \
      https://github.com/gramps-project/gramps /app/gramps-src && \
    pip install --no-cache-dir -e /app/gramps-src --no-deps

# The ten /api/<type>/query/ endpoints this project's client is built on
# (https://github.com/gramps-project/gramps-web-api/pull/913) are merged
# upstream now, so this tracks gramps-project master rather than the
# dsblank/gramps-web-api feat/object-query-endpoints branch it used to.
RUN git clone --depth 1 --branch master \
      https://github.com/gramps-project/gramps-web-api /app/gramps-web-api-src && \
    pip install --no-cache-dir -e /app/gramps-web-api-src --no-deps

# PyGObject: gramps/gen/const.py unconditionally does
# `from gi.repository import GLib` (just to compute XDG dirs -- no real GTK
# UI is ever touched on gramps-web-api's request path), so it's needed at
# import time even though it's not gramps-web-api's a core functional dep.
# The standalone PyInstaller build avoids this with a stub module
# (runtime_hooks/rthook_gi_stub.py) since bundling real PyGObject there is
# painful; here the base image already has the GTK typelibs/build deps
# (gir1.2-gtk-3.0, libgirepository1.0-dev, libcairo2-dev, pkg-config)
# specifically so PyGObject can be pip-installed on top, so we do that
# instead of reimplementing the stub trick.
RUN pip install --no-cache-dir "PYGObject<=3.50.0"

# Every non-gramps dependency of gramps-web-api's own pyproject.toml
# [project.dependencies], copied from
# .github/workflows/build-standalone.yml's already-debugged list. Skips
# pyinstaller/pyinstaller-hooks-contrib (not relevant to a container).
# psycopg2-binary isn't listed explicitly but arrives transitively via
# sifts's own dependencies.
RUN pip install --no-cache-dir \
      orjson Click Flask "Flask-Caching>=2.0.0" Flask-Compress Flask-Cors \
      "Flask-JWT-Extended!=4.4.0,!=4.4.1" "Flask-Limiter>=2.9.0" Flask-SQLAlchemy \
      "marshmallow>=3.13.0" waitress webargs "SQLAlchemy>=2.0.0" \
      "Pillow>=9.1.0,<12.0.0" "bleach[css]>=5.0.0" jsonschema \
      alembic "celery[redis]" Unidecode \
      "gramps-object-query-language>=0.3.1" "gramps-ql>=0.4.0" "object-ql>=0.1.3" \
      "sifts>=1.1.0" requests "yclade>=0.5.0" "Authlib>=1.6.4" gramps-gedcom7 \
      flask-smorest "typing-extensions>=4.13.0"

# Persistent data directories -- mount a volume covering /app/db, /app/media,
# /app/indexdir, /app/users, /app/secret (see deploy/docker-compose.yml).
RUN mkdir -p \
      /app/db /app/media /app/indexdir /app/users /app/secret \
      /app/thumbnail_cache \
      /app/cache/reports /app/cache/export \
      /app/cache/request_cache /app/cache/persistent_cache

COPY --from=frontend-build /src/app/dist /app/static

ENV GRAMPSWEB_USER_DB_URI=sqlite:////app/users/users.sqlite \
    GRAMPSWEB_MEDIA_BASE_DIR=/app/media \
    GRAMPSWEB_SEARCH_INDEX_DB_URI=sqlite:////app/indexdir/search_index.db \
    GRAMPSWEB_STATIC_PATH=/app/static \
    GRAMPSWEB_THUMBNAIL_CACHE_CONFIG__CACHE_DIR=/app/thumbnail_cache \
    GRAMPSWEB_REQUEST_CACHE_CONFIG__CACHE_DIR=/app/cache/request_cache \
    GRAMPSWEB_PERSISTENT_CACHE_CONFIG__CACHE_DIR=/app/cache/persistent_cache \
    GRAMPSWEB_REPORT_DIR=/app/cache/reports \
    GRAMPSWEB_EXPORT_DIR=/app/cache/export \
    GRAMPS_DATABASE_PATH=/app/db

# Dockerfile.base installs Gramps addons (incl. SharedPostgreSQL) into
# /root/gramps/gramps60/plugins -- GRAMPSHOME must point there for Gramps'
# plugin scanner to find them (matches upstream gramps-web-api's own
# Dockerfile, which sets GRAMPSHOME=/root for the same reason). Not on a
# volume: addons are baked into the image, nothing here needs to persist.
ENV GRAMPSHOME=/root

# Deliberately not set here: GRAMPSWEB_SECRET_KEY, GRAMPSWEB_TREE,
# GRAMPSWEB_POSTGRES_*, GRAMPSWEB_ADMIN_USER/PASSWORD. Those are real
# secrets/config, supplied at `docker compose` runtime via deploy/.env --
# never baked into the image.

EXPOSE 5000

COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD gunicorn -w ${GUNICORN_NUM_WORKERS:-4} -b 0.0.0.0:5000 \
      gramps_webapi.wsgi:app \
      --timeout ${GUNICORN_TIMEOUT:-120} \
      --limit-request-line 8190
