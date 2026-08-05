#!/usr/bin/env bash
# Stands up the Layer 3 fixture: a multi-tree gramps-web-api instance
# backed by real Postgres (SharedPostgreSQL addon), with a fresh tree
# holding Gramps' own example.gramps sample data, and starts the server
# on :5003. Live sync (app/src/store/historyPoll.ts) polls this server's
# GET /api/transactions/history/ endpoint directly -- no trigger or relay
# process to install here anymore (see git history for the old
# triggers.sql/relay.py this fixture used to also set up).
#
# Requires:
#  - A reachable Postgres server with the "gramps" database already
#    created and a "gramps"/"gramps" role matching config.cfg's
#    POSTGRES_USER/PASSWORD (see config.cfg's own header comment for
#    why per-request access and tree *creation* need this role two
#    different ways).
#  - The SharedPostgreSQL addon checked out at
#    ~/gramps/addons-source/SharedPostgreSQL.
#  - gramps-web-api's resources/trees.py passing POSTGRES_USER/PASSWORD
#    into the WebDbManager(...) call in TreesResource.post -- without
#    that fix, tree creation below fails with "no password supplied"
#    (this fixture's tree already exists, so day-to-day use isn't
#    affected, but a from-scratch rebuild needs it).
#  - gramps and gramps_webapi importable (pip installed from
#    ~/gramps/gramps and ~/gramps/gramps-web-api checkouts).
#
# NOT idempotent against an already-populated tree -- importing twice
# duplicates every object (no merge-by-gramps_id). Only run this
# against a fresh Postgres "gramps" database / before this fixture's
# tree exists yet.
set -euo pipefail

cd "$(dirname "$0")"
export GRAMPSHOME="$PWD/gramps-home"
export GRAMPS_RESOURCES="$HOME/gramps/gramps/build/share"
EXAMPLE_GRAMPS="$HOME/gramps/gramps/example/gramps/example.gramps"

rm -rf gramps-home data
# grampsdb is where WebDbManager._create() os.mkdir()s each new tree's own
# subdirectory -- os.mkdir() (not os.makedirs()) needs this parent to
# already exist, and nothing else in this bootstrap creates it.
mkdir -p gramps-home/gramps/gramps60/plugins gramps-home/gramps/grampsdb data

# A copy, not a symlink -- Gramps' plugin scanner walks this tree with
# os.walk()'s default followlinks=False, so a symlinked addon directory is
# listed but never actually descended into, and its .gpr.py never found.
# Re-run this script to pick up addon source changes.
cp -r "$HOME/gramps/addons-source/SharedPostgreSQL" \
  gramps-home/gramps/gramps60/plugins/SharedPostgreSQL

echo "adding owner user (no tree yet -- multi-tree mode has no auto-create,"
echo "and tree creation itself needs an authenticated request)..."
python3 -m gramps_webapi --config ./config.cfg user add gramps gramps \
  --role 5 --fullname "Gramps Owner"

echo "starting server on :5003..."
python3 -m gramps_webapi --config ./config.cfg run -p 5003 &
SERVER_PID=$!
sleep 2

TOKEN=$(curl -sf -X POST http://localhost:5003/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username": "gramps", "password": "gramps"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "creating tree..."
TREE_UUID=$(curl -sf -X POST http://localhost:5003/api/trees/ \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "layer3-demo"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "tree id: $TREE_UUID"

# Same fixup as the other two fixtures' setup.sh: the user row can't
# carry the real tree ID until the tree itself exists.
python3 -c "
import sqlite3
conn = sqlite3.connect('data/users.sqlite')
conn.execute(\"UPDATE users SET tree = ? WHERE name = 'gramps'\", ('$TREE_UUID',))
conn.commit()
"

# A fresh login picks up the now-patched tree claim -- the token above
# was minted before the UPDATE. /api/token/ is rate-limited to 1/second
# (see token.py's @limiter.limit("1/second")), so back-to-back with the
# first login above gets a 429 without this.
sleep 1
TOKEN=$(curl -sf -X POST http://localhost:5003/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username": "gramps", "password": "gramps"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "importing $EXAMPLE_GRAMPS..."
curl -sf -X POST http://localhost:5003/api/importers/gramps/file \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary "@$EXAMPLE_GRAMPS" \
  -H "Content-Type: application/octet-stream"
echo

# Postgres's query planner needs table statistics to pick a sane index
# for the birth/death-date correlated subqueries object_query.py
# compiles (person -> event via birth_ref_index/death_ref_index).
# A freshly bulk-imported table has none until autovacuum's
# autoanalyze gets around to it, which isn't guaranteed to happen
# before the first request -- skipping this step once turned a single
# /api/people/query/ page into a 30+ second request (bad index choice,
# ~2100 of 2157 event rows scanned per lookup x 1000 rows) instead of
# the ~30ms it takes with fresh stats.
echo "analyzing tables so the query planner has fresh stats..."
PGPASSWORD="${POSTGRES_PASSWORD:-gramps}" psql -h "${POSTGRES_HOST:-localhost}" \
  -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-gramps}" -d gramps -c "ANALYZE;"

echo
echo "API server running as PID $SERVER_PID on :5003 (kill it when done: kill $SERVER_PID)"
echo "app/.env.example's VITE_API_BASE already points here."
