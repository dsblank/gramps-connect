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
 * to be the actual cost driver. Every one of these field paths already
 * routes through `count: true`, which forces the server to evaluate the
 * `like()` predicate over every candidate row regardless of pattern shape
 * to produce an exact total -- so a prefix scan's usual "stop once you have
 * an index-ordered range" saving never applied here in the first place.
 * Measured prefix vs. infix cost on the same field was within noise (e.g.
 * person.surname: 47ms vs. 47ms on SQLite, 64ms vs. 66ms on Postgres, for
 * 101,518 rows). What actually moved the needle 6-15x was whether the field
 * is a flat, secondary-indexed column (person.surname, place.title,
 * source.title, ...) versus a JSON-embedded or relationship-crossing one
 * (family.father.surname: 116-275ms on 46,315 rows; Note/Message/Story's
 * text.string has no flat-column alternative at all -- Gramps' note table
 * carries no plain text column, only json_data). So the field lists below
 * already do the load-bearing work; this prefix-only rule was pure recall
 * loss ("mith" no longer finding "Smith") for no measured benefit.
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
