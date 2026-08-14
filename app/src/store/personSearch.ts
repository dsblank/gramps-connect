/** Builds PERSON_VIEW's where_expr from free text:
 * - any whitespace/comma-separated word that exactly matches a Gramps ID
 *   (e.g. "I2157") matches directly, regardless of what else is present
 *   -- lets an ID pasted alongside a name still hit.
 * - a comma splits the name-shaped part as "Surname, Given" -- the
 *   conventional Last, First order (e.g. "Smith, Lisa" -> surname prefix
 *   "Smith", given prefix "Lisa"), each side kept whole rather than
 *   further split, since either can itself be multiple words ("Van Der
 *   Berg, Lisa Marie").
 * - without a comma, a single word is checked against *both* given_name
 *   and surname (a bare "Smith" shouldn't require knowing which field
 *   it's in); two or more words take the *last* as a surname prefix and
 *   everything before it, joined, as a given-name prefix -- Gramps'
 *   given_name field can itself hold more than one word (e.g. "Mary
 *   Jane"), so "John Q Public" matches given_name~="John Q" and
 *   surname~="Public" rather than just the first word.
 * Quote/backslash characters are stripped rather than escaped, since a
 * where_expr is a parsed expression, not a value to sanitize into. */
export function buildPersonSearchExpr(query: string): string | null {
  const sanitize = (s: string) => s.replace(/['\\]/g, "").trim();
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const idWords = trimmed.split(/[\s,]+/).map(sanitize).filter(Boolean);
  const idClause = `gramps_id in [${idWords.map((w) => `'${w}'`).join(", ")}]`;

  let nameClause: string;
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex >= 0) {
    const surname = sanitize(trimmed.slice(0, commaIndex));
    const given = sanitize(trimmed.slice(commaIndex + 1));
    nameClause = `like(given_name, '${given}%') and like(surname, '${surname}%')`;
  } else {
    const words = trimmed.split(/\s+/).map(sanitize).filter(Boolean);
    if (words.length === 1) {
      nameClause = `like(given_name, '${words[0]}%') or like(surname, '${words[0]}%')`;
    } else {
      const surname = words[words.length - 1];
      const given = words.slice(0, -1).join(" ");
      nameClause = `like(given_name, '${given}%') and like(surname, '${surname}%')`;
    }
  }

  return `(${idClause}) or (${nameClause})`;
}
