// Typed text spliced into a GOQL string literal. A where_expr is built as
// text, so a quote in the value would otherwise end the literal early (or
// add GOQL of its own). GOQL string literals are Python's: `\'` and `\"`
// stand for the quote itself inside either kind of quotes, so "O'Neil"
// still finds O'Neil.

/** `raw` escaped for any GOQL string literal, matched exactly as typed:
 * backslashes doubled, both kinds of quote backslash-escaped. */
export function goqlTextValue(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/** A search term for a `like(field, '%...%')` pattern: backslashes dropped
 * (in a pattern, one would escape the next character, and a trailing one
 * is an error), quotes escaped. `%` and `_` stay wildcards. */
export function goqlLikeTerm(raw: string): string {
  return goqlTextValue(raw.replace(/\\/g, ""));
}
