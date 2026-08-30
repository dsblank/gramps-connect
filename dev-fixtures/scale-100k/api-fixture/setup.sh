#!/usr/bin/env bash
# Rebuilds the scale-100k fixture from scratch: a single-tree gramps-web-api
# instance backed by SQLite, imported from a 101,518-person synthetic tree
# (~46MB gzipped XML) via gramps-web-api's still-draft empty-tree fast
# import path -- the ordinary importer takes 20+ hours on a tree this size
# (confirmed live, 2026-08-29); the fast path took 4m37s.
#
# gramps-home/ and data/ here are already built (do not run this script
# unless you specifically want to regenerate them -- it's destructive, same
# as ../../layer2-local-cache and ../../layer3-sync's own setup.sh). Kept
# around specifically for repeat load/performance experiments (discussion
# #4) rather than one-off use, so it isn't worth rebuilding per session.
#
# Needs, as of 2026-08-29:
#  - gramps-web-api PRs #959 ("Empty-tree fast import: bulk_copy, inline
#    secondary columns, no double-parse") and #958 ("Speed up full search
#    reindex...") -- both still DRAFT, developed together, with one
#    overlapping fix (#959 originated it, #958 re-derived it standalone).
#    Once either merges to main, drop this merge step and just use a plain
#    gramps-web-api checkout instead -- this whole dance is a workaround
#    for both being unmerged at once, not a permanent requirement.
#  - gramps and gramps_webapi importable (pip installed from
#    ~/gramps/gramps and ~/gramps/gramps-web-api checkouts) for the `user
#    add` step below, which uses whatever's on PYTHONPATH at that point
#    (deliberately NOT the merged worktree -- see below).
#  - The 100k-person source file: ~/gramps/gramps-web-api/gen-100k.gramps
#    (any gramps-web-api-importable format works -- a gwfi bundle via the
#    GrampsFastImport addon parses faster than XML, but wasn't needed to
#    hit 4m37s here).
set -euo pipefail

cd "$(dirname "$0")"
export GRAMPSHOME="$PWD/gramps-home"
export GRAMPS_RESOURCES="$HOME/gramps/gramps/build/share"
GEN_100K="$HOME/gramps/gramps-web-api/gen-100k.gramps"

rm -rf gramps-home data
mkdir -p gramps-home data

# Merge the two draft PR branches into a throwaway worktree -- the running
# server needs PYTHONPATH pointed at *this*, not a plain gramps-web-api
# checkout, for the fast import path to actually be present. `user add`
# above deliberately runs without this override: it's unaffected by either
# PR and there's no reason to depend on unmerged code for it.
COMBINED_WT="$(mktemp -d)/gramps-web-api-combined"
git -C "$HOME/gramps/gramps-web-api" worktree add "$COMBINED_WT" -b "scale-100k-rebuild-$(date +%s)" perf/empty-tree-bulk-import
git -C "$COMBINED_WT" merge --no-edit perf/reindex-throttle-and-backlink-preload

echo "adding user (tree name only -- gets a real tree ID once the server starts)..."
python3 -m gramps_webapi --config ./config.cfg user add gramps gramps \
  --role 4 --tree bench-100k --fullname "Scale Bench User"

echo "starting server on :5098 (fast-import branches)..."
PYTHONPATH="$COMBINED_WT" python3 -m gramps_webapi --config ./config.cfg run -p 5098 &
SERVER_PID=$!
sleep 3

# Same fixup as the other fixtures' setup.sh: `user add --tree` stores the
# literal display name, not a real ID, since none exists until the server
# auto-creates the tree at startup (single-TREE config only).
TREE_ID=$(basename "$(find gramps-home/gramps/grampsdb -mindepth 1 -maxdepth 1 -type d)")
echo "tree id: $TREE_ID"
python3 -c "
import sqlite3
conn = sqlite3.connect('data/users.sqlite')
conn.execute(\"UPDATE users SET tree = ? WHERE name = 'gramps'\", ('$TREE_ID',))
conn.commit()
"

TOKEN=$(curl -sf -X POST http://localhost:5098/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username": "gramps", "password": "gramps"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "importing $GEN_100K (this is the ~4-5 minute step)..."
time curl -sf -X POST http://localhost:5098/api/importers/gramps/file \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary "@$GEN_100K" \
  -H "Content-Type: application/octet-stream"
echo

echo "stopping server (PID $SERVER_PID)..."
kill "$SERVER_PID"
git -C "$HOME/gramps/gramps-web-api" worktree remove "$COMBINED_WT" --force

echo
echo "Done. To serve this fixture afterward, an ordinary (unmodified)"
echo "gramps-web-api checkout is enough -- the fast-import branches were"
echo "only needed to build it, not to query it:"
echo "  cd $(pwd) && GRAMPSHOME=\"\$PWD/gramps-home\" GRAMPS_RESOURCES=\"\$HOME/gramps/gramps/build/share\" python3 -m gramps_webapi --config ./config.cfg run -p 5098"
