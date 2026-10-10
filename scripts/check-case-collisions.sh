#!/usr/bin/env bash
# Fails if two tracked paths would be the same path on a case-insensitive
# filesystem (macOS, Windows). Linux CI and the Docker build can't see
# these, but the desktop builds' tsc fails on them -- v0.8.14's first
# macOS/Windows build broke on pyodidePoc/grampletWindows.ts beside
# GrampletWindows.tsx.
#
# Compares, case-folded: every tracked file, every directory, and every
# JS/TS module path with its extension removed (an import names a module
# without one, so foo.ts and Foo.tsx clash even though the files don't).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

collisions=$(
  {
    git ls-files
    # Every directory, including parents of directories.
    git ls-files | awk -F/ '{ p = $1; for (i = 2; i < NF; i++) { print p; p = p "/" $i } if (NF > 1) print p }'
    git ls-files | sed -nE 's/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$//p'
  } | sort -u | sort -f | uniq -di
)

if [ -n "$collisions" ]; then
  echo "Paths that differ only in case (they collide on macOS/Windows):" >&2
  while IFS= read -r p; do
    git ls-files | grep -iE "^$(printf '%s' "$p" | sed 's/[][\.*^$+?(){}|/]/\\&/g')(/|\.|$)" | sed 's/^/  /' >&2
  done <<< "$collisions"
  exit 1
fi
echo "No case-only path collisions."
