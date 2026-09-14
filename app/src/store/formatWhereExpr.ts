/**
 * Cosmetic pretty-printer for a compiled `where_expr` string -- breaks
 * onto new lines at top-level `and`/`or` boundaries and indents nested
 * parenthesized groups, purely for the "Filters" dialog's own read-only
 * preview (FilterPickerDialog.tsx). Never touches the string that's
 * actually sent to the server (`combineFilterTree`'s own output stays
 * exactly as compiled) -- this only reformats a copy for display.
 *
 * Works by scanning paren-balance rather than parsing GOQL's real grammar,
 * so it only understands the shapes our own combiner produces (`(leaf)`,
 * `(A) and (B) and ...`, `(A) or (B) or ...`, `not (A)`) -- a hand-typed
 * expression with the literal substring " and "/" or " inside a string
 * literal could split oddly, but this is a read-only preview, never the
 * string that's actually submitted, so a rare cosmetic misformat there is
 * harmless.
 */
export function formatWhereExpr(expr: string): string {
  const lines: string[] = [];
  emit(expr.trim(), 0, lines);
  return lines.join("\n");
}

const TOP_LEVEL_OPS = [" and ", " or "];

/** Splits `s` on occurrences of `ops` that sit at paren-depth 0 (i.e. not
 * inside some inner group) -- `"(a) and (b)"` splits on its `and`,
 * `"((a) and (b))"` doesn't (that `and` is at depth 1, inside the outer
 * pair). Each result's `opBefore` is the operator immediately preceding
 * it (`null` for the first piece). */
function splitTopLevel(s: string, ops: string[]): { text: string; opBefore: string | null }[] {
  const result: { text: string; opBefore: string | null }[] = [];
  let depth = 0;
  let start = 0;
  let opBefore: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0) {
      const matchedOp = ops.find((op) => s.startsWith(op, i));
      if (matchedOp) {
        result.push({ text: s.slice(start, i), opBefore });
        opBefore = matchedOp.trim();
        i += matchedOp.length - 1;
        start = i + 1;
      }
    }
  }
  result.push({ text: s.slice(start), opBefore });
  return result;
}

/** `s` with its outermost `(`/`)` pair removed, only when that pair truly
 * wraps the *entire* string (paren-depth returns to 0 exactly at the last
 * character) -- `"(a) and (b)"` isn't stripped (depth hits 0 right after
 * the first `)`, long before the string ends), `"((a) and (b))"` is.
 * `null` when `s` isn't wrapped that way at all. */
function stripOuterParens(s: string): string | null {
  if (!s.startsWith("(") || !s.endsWith(")")) return null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i === s.length - 1 ? s.slice(1, -1) : null;
    }
  }
  return null;
}

/** The condition wrapped by `not (...)` when `s` is *exactly* that shape
 * (nothing before `not`, nothing after the matching `)`); `null`
 * otherwise. */
function stripNot(s: string): string | null {
  if (!s.startsWith("not ")) return null;
  return stripOuterParens(s.slice(4).trim());
}

/** True when `s` reads as more than one flat leaf on its own -- has a
 * top-level `and`/`or`, is a `not (...)` wrapper, or is itself another
 * parenthesized group -- i.e. it's worth its own indented block rather
 * than staying inline with its enclosing parens. */
function isCompound(s: string): boolean {
  const trimmed = s.trim();
  return (
    splitTopLevel(trimmed, TOP_LEVEL_OPS).length > 1 ||
    stripNot(trimmed) !== null ||
    stripOuterParens(trimmed) !== null
  );
}

function emit(s: string, depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth);
  const trimmed = s.trim();

  const parts = splitTopLevel(trimmed, TOP_LEVEL_OPS);
  if (parts.length > 1) {
    for (const part of parts) {
      if (part.opBefore) lines.push(`${indent}${part.opBefore}`);
      emit(part.text, depth, lines);
    }
    return;
  }

  const notInner = stripNot(trimmed);
  if (notInner !== null) {
    lines.push(`${indent}not (`);
    emit(notInner, depth + 1, lines);
    lines.push(`${indent})`);
    return;
  }

  const paren = stripOuterParens(trimmed);
  if (paren !== null && isCompound(paren)) {
    lines.push(`${indent}(`);
    emit(paren, depth + 1, lines);
    lines.push(`${indent})`);
    return;
  }

  lines.push(`${indent}${trimmed}`);
}
