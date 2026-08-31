/** Fields checked for each word of a person search query. */
const SEARCH_FIELDS = ["given_name", "surname", "gramps_id"];

/** Builds PERSON_VIEW's where_expr from free text: commas are dropped, the
 * rest is split into words, and each word must appear in at least one of
 * SEARCH_FIELDS (its per-word clauses are OR'd); the per-word clauses are
 * then AND'd together, so "john smith" requires both words to be found,
 * each in any field, rather than assuming which word is the given name vs.
 * surname. Quote/backslash characters are stripped rather than escaped,
 * since a where_expr is a parsed expression, not a value to sanitize into.
 *
 * Leading+trailing wildcard per word -- see simpleSearch.ts's own doc
 * comment for the full story of why the prefix-only rule (discussion #4,
 * F8) was reverted: given_name/surname/gramps_id are flat, secondary-
 * indexed columns on person, but neither backend actually uses that index
 * for a `like()` here (SQLite's case-insensitive-by-default LIKE can't seek
 * a binary-collated index; Postgres's index is composite and this data's
 * skew makes a sequential scan cheaper anyway) -- so prefix vs. infix cost
 * was within noise either way, and prefix-only was pure recall loss ("ith"
 * no longer finding "Smith") for no measured speed benefit. */
export function buildPersonSearchExpr(query: string): string | null {
  const trimmed = query.replace(/,/g, " ").trim();
  if (trimmed.length < 2) return null;

  const words = trimmed
    .split(/\s+/)
    .map((w) => w.replace(/['\\]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return null;

  return words
    .map((word) => `(${SEARCH_FIELDS.map((field) => `like(${field}, '%${word}%')`).join(" or ")})`)
    .join(" and ");
}
