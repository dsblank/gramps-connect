#!/usr/bin/env bash
# Stands up a throwaway, isolated gramps-web-api instance for the
# Layer 2 spike: its own GRAMPSHOME, user db, and tree. Generates a
# 3000-person dataset via gramps-bench, imports it, and starts the
# dev server on :5001.
#
# Requires: gramps and gramps_webapi importable (pip installed from
# ~/gramps/gramps and ~/gramps/gramps-web-api checkouts), and
# gramps-bench checked out at ~/gramps/gramps-bench.
set -euo pipefail

cd "$(dirname "$0")"
export GRAMPSHOME="$PWD/gramps-home"
export GRAMPS_RESOURCES="$HOME/gramps/gramps/build/share"

rm -rf gramps-home data
mkdir -p gramps-home data

python3 -m gramps_webapi --config ./config.cfg user add testuser testpass \
  --role 4 --tree layer2-spike --fullname "Layer 2 Spike"

TREE_ID=$(python3 -m gramps_webapi --config ./config.cfg tree list \
  | tail -1 | awk '{print $1}')
echo "tree id: $TREE_ID"

python3 -c "
import sqlite3
conn = sqlite3.connect('data/users.sqlite')
conn.execute(\"UPDATE users SET tree = ? WHERE name = 'testuser'\", ('$TREE_ID',))
conn.commit()
"

echo "generating 3000-person dataset..."
GEN_DB=$(mktemp -d)/src-db
(cd "$HOME/gramps/gramps-bench" && python3 -m gramps_bench.database_generator 3000 \
  --path "$GEN_DB" --seed 42 --quiet)

python3 export_to_gramps_xml.py "$GEN_DB" ./layer2-dataset.gramps

echo "starting server on :5001..."
python3 -m gramps_webapi --config ./config.cfg run -p 5001 &
SERVER_PID=$!
sleep 2

TOKEN=$(curl -s -X POST http://localhost:5001/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "testpass"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "importing dataset..."
curl -s -X POST http://localhost:5001/api/importers/gramps/file \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary "@./layer2-dataset.gramps" \
  -H "Content-Type: application/octet-stream"

echo
echo "API server running as PID $SERVER_PID on :5001 (kill it when done: kill $SERVER_PID)"
echo "logs in as testuser/testpass and fetches live from this server via"
echo "POST /api/people/query/ -- no fixture dump needed."
echo
echo "to point app/ at this instance instead of dev-fixtures/layer3-sync's"
echo "(no live sync here, plain SQLite): set VITE_API_BASE=http://localhost:5001"
echo "in app/.env.local, then 'npm run dev -w app' as usual."
