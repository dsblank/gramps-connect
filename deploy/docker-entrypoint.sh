#!/bin/sh
set -e

# Use a random Flask secret key if none was supplied via GRAMPSWEB_SECRET_KEY
# (real deployments should set it explicitly, but this keeps a first boot
# without one from breaking, and keeps the generated value stable across
# restarts by persisting it on the /app/secret volume). Adapted from
# gramps-web-api's own docker-entrypoint.sh.
if [ -z "$GRAMPSWEB_SECRET_KEY" ]; then
    if [ ! -s /app/secret/secret ]; then
        mkdir -p /app/secret
        python3 -c "import secrets; print(secrets.token_urlsafe(32))" | tr -d "\n" > /app/secret/secret
    fi
    export GRAMPSWEB_SECRET_KEY="$(cat /app/secret/secret)"
fi

# `depends_on` in docker-compose only waits for the postgres container to
# start, not for postgres itself to accept connections -- wait here instead.
if [ -n "$GRAMPSWEB_POSTGRES_HOST" ]; then
    echo "Waiting for Postgres at $GRAMPSWEB_POSTGRES_HOST:${GRAMPSWEB_POSTGRES_PORT:-5432} ..."
    attempt=0
    until pg_isready -h "$GRAMPSWEB_POSTGRES_HOST" -p "${GRAMPSWEB_POSTGRES_PORT:-5432}" -U "$GRAMPSWEB_POSTGRES_USER" -q; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 30 ]; then
            echo "Postgres did not become ready in time" >&2
            exit 1
        fi
        sleep 2
    done
fi

# Migrations and admin seeding only need to happen once. The celery worker
# service shares the same image/entrypoint and the same sqlite USER_DB_URI
# volume as the app service -- running alembic from both containers at once
# on container startup risks "database is locked" on sqlite, so the worker
# sets SKIP_MIGRATE_AND_SEED=1 and lets the app service own this.
if [ -z "$SKIP_MIGRATE_AND_SEED" ]; then
    # Upgrade the user database schema, if required. alembic.ini
    # (script_location = alembic_users) lives at the gramps-web-api source
    # root, so alembic must be run from there -- matching gramps-web-api's
    # own docker-entrypoint.sh.
    (cd /app/gramps-web-api-src && python3 -m gramps_webapi user migrate)

    # Seed the site admin user on first boot. Idempotent: a rerun on
    # container restart hits "User already exists" and is treated as
    # success; any other failure (e.g. required env vars unset, DB
    # unreachable) aborts startup.
    if [ -z "$GRAMPSWEB_ADMIN_USER" ] || [ -z "$GRAMPSWEB_ADMIN_PASSWORD" ]; then
        echo "GRAMPSWEB_ADMIN_USER and GRAMPSWEB_ADMIN_PASSWORD must both be set" >&2
        exit 1
    fi
    # ROLE_ADMIN = 5 (gramps_webapi.auth.const) -- site admin, not tied to a
    # single tree, required in multi-tree (GRAMPSWEB_TREE=*) mode.
    if ! OUTPUT=$(python3 -m gramps_webapi user add "$GRAMPSWEB_ADMIN_USER" "$GRAMPSWEB_ADMIN_PASSWORD" --role 5 2>&1); then
        case "$OUTPUT" in
            *"already exists"*)
                ;;
            *)
                echo "$OUTPUT" >&2
                exit 1
                ;;
        esac
    fi
fi

exec "$@"
