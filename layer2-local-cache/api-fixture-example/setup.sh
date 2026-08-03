#!/usr/bin/env bash
# Stands up a second, separate single-tree gramps-web-api instance loaded
# with Gramps' own official example.gramps sample database -- rich date
# variety (modifiers, quality, ranges/spans), unlike ../api-fixture's
# gramps-bench-generated data, which is all plain, unmodified dates.
#
# A tree name is only auto-created via WebDbManager's create_if_missing at
# *app startup*, for the single TREE this config names (see
# gramps-web-api's app.py) -- there's no way to add a second tree to a
# single-tree instance at runtime, hence a whole separate
# instance/port (5002) rather than a second tree on api-fixture's server.
#
# Requires: gramps and gramps_webapi importable (pip installed from
# ~/gramps/gramps and ~/gramps/gramps-web-api checkouts). example.gramps
# itself ships inside the gramps checkout at example/gramps/example.gramps.
set -euo pipefail

cd "$(dirname "$0")"
export GRAMPSHOME="$PWD/gramps-home"
export GRAMPS_RESOURCES="$HOME/gramps/gramps/build/share"
EXAMPLE_GRAMPS="$HOME/gramps/gramps/example/gramps/example.gramps"

rm -rf gramps-home data
mkdir -p gramps-home data

echo "adding user (tree name only -- gets a real tree ID once the server starts)..."
python3 -m gramps_webapi --config ./config.cfg user add exampleuser examplepass \
  --role 4 --tree example-db --fullname "Example DB"

echo "starting server on :5002 (auto-creates the 'example-db' tree since it's this config's single TREE)..."
python3 -m gramps_webapi --config ./config.cfg run -p 5002 &
SERVER_PID=$!
sleep 2

# The user record above stores the literal string "example-db" in its
# `tree` column -- `user add --tree` takes a real tree ID, not a display
# name, and there was no real ID yet at that point. Fix it up now that the
# server has auto-created the tree and it has one.
TREE_ID=$(python3 -m gramps_webapi --config ./config.cfg tree list | tail -1 | awk '{print $1}')
echo "tree id: $TREE_ID"
python3 -c "
import sqlite3
conn = sqlite3.connect('data/users.sqlite')
conn.execute(\"UPDATE users SET tree = ? WHERE name = 'exampleuser'\", ('$TREE_ID',))
conn.commit()
"

TOKEN=$(curl -s -X POST http://localhost:5002/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username": "exampleuser", "password": "examplepass"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "importing example.gramps..."
curl -s -X POST http://localhost:5002/api/importers/gramps/file \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary "@$EXAMPLE_GRAMPS" \
  -H "Content-Type: application/octet-stream"

echo
echo "server running as PID $SERVER_PID on :5002 (kill it when done: kill $SERVER_PID)"
echo "browser.ts's API_BASE/USERNAME/PASSWORD already point here -- see its own"
echo "comment for how to switch back to ../api-fixture's 100k-person dataset."
