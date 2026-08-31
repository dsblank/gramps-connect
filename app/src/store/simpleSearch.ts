/** Builds a FilterBar "plain text" search-mode where_expr: an OR of
 * `like(field, 'query%')` across the given field paths (a path can cross a
 * relationship, e.g. "father.surname" -- see gramps-object-query-language's
 * dotted-path support, already relied on by searchHelp.ts's own examples).
 * Returns null under the same "too short" rule as personSearch.ts's
 * buildPersonSearchExpr, so an empty or 1-character box clears the filter
 * rather than running a query that would match everything.
 *
 * Leading+trailing wildcard (reverted from the prefix-only rule discussion
 * #4/F8 introduced): benchmarked against the 100k-row bench fixtures
 * (gramps-web-api session 2026-08-31) and a leading wildcard turned out not
 * to be the actual cost driver. Measured prefix vs. infix cost on the same
 * field was within noise (e.g. person.surname: 47ms vs. 47ms on SQLite,
 * 64ms vs. 66ms on Postgres, for 101,518 rows) -- NOT because `count: true`
 * defeats the index (that was the first theory here and it's wrong: forcing
 * SQLite's `case_sensitive_like` pragma on, so the index becomes usable,
 * keeps the windowed count fast too, ~1ms), but because the secondary index
 * isn't actually being used for either pattern in the first place, for two
 * different reasons per backend, both confirmed with EXPLAIN:
 *   - SQLite: `LIKE` is case-insensitive by default, but the index sorts by
 *     the default binary (case-sensitive) collation, so the planner can't
 *     turn `col LIKE 'Sm%'` into an index range seek without risking missed
 *     rows -- it falls back to `SCAN person`, a full table scan, for both
 *     patterns. (Flipping `case_sensitive_like` on does switch the plan to
 *     `SEARCH ... USING INDEX person_surname (surname>? AND surname<?)` and
 *     cuts cost ~40x -- confirming the index itself is fine, just unusable
 *     under case-insensitive semantics.)
 *   - PostgreSQL: the index is composite, `(treeid, surname)`, not `surname`
 *     alone, and this bench fixture's data is dominated by one tree (94% of
 *     rows) -- the planner correctly prefers `Seq Scan` over an index scan
 *     that would still touch nearly the whole table either way.
 * So a "flat, secondary-indexed column" being fast here (person.surname,
 * place.title, source.title, ...) versus a JSON-embedded or
 * relationship-crossing one being slow (family.father.surname: 116-275ms on
 * 46,315 rows; Note/Message/Story's text.string has no flat-column
 * alternative at all -- Gramps' note table carries no plain text column,
 * only json_data) has nothing to do with index seeks either -- it's that
 * comparing a plain TEXT column during a full scan is cheap, while
 * extracting a nested value from JSON (or crossing a relationship) per row
 * isn't. "Indexed" was a red herring; "flat column" was the real variable.
 * (A genuinely index-seek-backed prefix search is possible -- case-sensitive
 * matching or a NOCASE index would get there -- just not what's happening
 * today, and it'd trade back the "ith" no longer finding "Smith" recall
 * loss this revert undid.) The field lists below already do the
 * load-bearing work; the prefix-only rule bought nothing measurable.
 *
 * Person is the one view that doesn't use this: a name search wants its
 * given/surname split into two fields rather than OR-ed as one match, so
 * it keeps its own builder in personSearch.ts. */
export function buildSimpleSearchExpr(fields: string[]): (query: string) => string | null {
  return (query: string) => {
    const trimmed = query.replace(/['\\]/g, "").trim();
    if (trimmed.length < 2) return null;
    return fields.map((field) => `like(${field}, '%${trimmed}%')`).join(" or ");
  };
}
