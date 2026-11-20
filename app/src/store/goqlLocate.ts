// Finding the GOQL expression to complete inside a field's text, for
// components/goqlCompletion/useGoqlCompletion.tsx -- the plain search box
// needs none of this (the whole box is the expression), but a Custom Rule
// has `{param}` placeholders, and a Gramplet's GOQL lives in Python string
// arguments.

/** Mask every `{...}` -- a Custom Rule's `{minAge}`, an f-string's
 * `{surname}` -- with an equally long run of `0`s, so completion reads it
 * as a value without any position in the text moving. GOQL itself never
 * uses braces. */
export function maskTemplateFields(text: string): string {
  return text.replace(/\{[^{}\n]*\}/g, (m) => "0".repeat(m.length));
}

/** The Python functions whose string argument is a where_expr, and the
 * GOQL type each searches: people("gender == 1"), people(where="..."). */
const PLURAL_NAMESPACES: Record<string, string> = {
  people: "Person",
  families: "Family",
  events: "Event",
  places: "Place",
  repositories: "Repository",
  sources: "Source",
  citations: "Citation",
  media: "Media",
  notes: "Note",
  tags: "Tag",
};

// Text just before a string that's the where argument: `people(` or
// `people(..., where=`.
const PLURAL_CALL_RE = new RegExp(
  `\\b(${Object.keys(PLURAL_NAMESPACES).join("|")})\\((?:\\s*|[^()]*\\bwhere\\s*=\\s*)$`,
);
// `filter("Person", ` / `count("person", where=` / `db.get_number_of("Person", `.
const TYPED_CALL_RE = /\b(?:filter|count|get_number_of)\(\s*(["'])([A-Za-z]+)\1\s*,(?:\s*|[^()]*\bwhere\s*=\s*)$/;
const NAMESPACES = new Set(Object.values(PLURAL_NAMESPACES));

export interface PythonGoqlString {
  namespace: string;
  /** Where the string's contents start and end in the code. */
  start: number;
  end: number;
  /** The quote character the string is delimited by. */
  quote: string;
}

interface PythonString {
  start: number;
  end: number;
  quote: string;
  /** Where the literal begins, including any prefix (`f`, `r`, ...). */
  literalStart: number;
}

/** The Python string literal whose contents contain `cursor`, or null
 * (cursor in code or a comment). Handles '...', "...", triple quotes,
 * prefixes and backslash escapes -- enough to tell string from code, not a
 * full tokenizer. */
function pythonStringAt(code: string, cursor: number): PythonString | null {
  let i = 0;
  while (i < cursor) {
    const ch = code[i];
    if (ch === "#") {
      const newline = code.indexOf("\n", i);
      if (newline === -1 || newline >= cursor) return null;
      i = newline + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const triple = code.startsWith(ch.repeat(3), i);
      const delimiter = triple ? ch.repeat(3) : ch;
      const prefix = /[rRbBfFuU]{1,2}$/.exec(code.slice(Math.max(0, i - 2), i));
      const literalStart = i - (prefix && !/\w/.test(code[i - prefix[0].length - 1] ?? "") ? prefix[0].length : 0);
      const contentStart = i + delimiter.length;
      let j = contentStart;
      let end = -1;
      while (j < code.length) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (!triple && code[j] === "\n") break;
        if (code.startsWith(delimiter, j)) {
          end = j;
          break;
        }
        j++;
      }
      const contentEnd = end === -1 ? j : end;
      if (cursor >= contentStart && cursor <= contentEnd) {
        return { start: contentStart, end: contentEnd, quote: ch, literalStart };
      }
      i = end === -1 ? j : end + delimiter.length;
      continue;
    }
    i++;
  }
  return null;
}

/** The GOQL where_expr string containing `cursor` in Gramplet Python code
 * -- an argument of people()/families()/..., filter()/count()/
 * db.get_number_of() -- or null when the cursor is anywhere else. */
export function goqlStringInPython(code: string, cursor: number): PythonGoqlString | null {
  const literal = pythonStringAt(code, cursor);
  if (!literal) return null;
  const before = code.slice(0, literal.literalStart);
  const plural = PLURAL_CALL_RE.exec(before);
  if (plural) return { namespace: PLURAL_NAMESPACES[plural[1]], start: literal.start, end: literal.end, quote: literal.quote };
  const typed = TYPED_CALL_RE.exec(before);
  if (typed) {
    const namespace = typed[2][0].toUpperCase() + typed[2].slice(1).toLowerCase();
    if (NAMESPACES.has(namespace)) return { namespace, start: literal.start, end: literal.end, quote: literal.quote };
  }
  return null;
}
