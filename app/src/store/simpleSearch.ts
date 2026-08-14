/** Builds a FilterBar "plain text" search-mode where_expr: an OR of
 * `like(field, '%query%')` across the given field paths (a path can cross a
 * relationship, e.g. "father.surname" -- see gramps-object-query-language's
 * dotted-path support, already relied on by searchHelp.ts's own examples).
 * Returns null under the same "too short" rule as personSearch.ts's
 * buildPersonSearchExpr, so an empty or 1-character box clears the filter
 * rather than running a query that would match everything.
 *
 * Person is the one view that doesn't use this: a name search wants its
 * given/surname split into two fields and prefix-matched rather than
 * OR-ed as one contains-match, so it keeps its own builder in
 * personSearch.ts. */
export function buildSimpleSearchExpr(fields: string[]): (query: string) => string | null {
  return (query: string) => {
    const trimmed = query.replace(/['\\]/g, "").trim();
    if (trimmed.length < 2) return null;
    return fields.map((field) => `like(${field}, '%${trimmed}%')`).join(" or ");
  };
}
