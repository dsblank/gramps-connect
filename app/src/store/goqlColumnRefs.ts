// Column names in GOQL: `Father`, `Grandchildren` -- a list's column,
// written in backticks, stands for the GOQL that column shows. The app
// swaps each one for its column's current expression just before a query
// is sent, so a filter follows the column when the column is edited.
//
// GOQL is parsed as a Python expression, where a backtick is a syntax
// error, so a backticked name can never mean anything else.
//
// Which columns can be named: a list's built-in columns, the tree's
// columns (treeColumnMedia.ts, whether or not this browser shows them),
// and -- for what's typed and run here, like the search box -- columns
// kept in this browser only. A Custom Rule is shared with the tree, so it
// may only name built-in and tree columns, and it stores each name as the
// column's id (`goql_k3x9`, `father_name`), shown as its title when
// edited: renaming a column then never breaks a rule.
import { t } from "../i18n/i18n";
import { builtinColumns, columnExpression, getTreeColumns, listCustomColumns } from "./columnSettings";
import { VIEWS } from "./views";

export class ColumnRefError extends Error {}

export interface ColumnRef {
  /** Index of the opening backtick. */
  start: number;
  /** Index just past the closing backtick. */
  end: number;
  /** The text between the backticks, trimmed. */
  name: string;
}

/** Every `name` in `text`, outside string literals. An opening backtick
 * with no closing one is an error. */
export function scanColumnRefs(text: string): { refs: ColumnRef[]; error: string | null } {
  const refs: ColumnRef[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i += 1;
      while (i < text.length && text[i] !== ch) i += text[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close < 0) return { refs, error: t("A column name is missing its closing `.") };
      refs.push({ start: i, end: close + 1, name: text.slice(i + 1, close).trim() });
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return { refs, error: null };
}

/** Where the column name being typed at `cursor` starts (just after its
 * opening backtick), or null when the cursor isn't inside one. */
export function openColumnRefAt(text: string, cursor: number): number | null {
  const before = text.slice(0, cursor);
  const { refs, error } = scanColumnRefs(before);
  if (!error) return null;
  const last = refs.length > 0 ? refs[refs.length - 1].end : 0;
  // The unclosed backtick: the first one after the last complete name
  // that isn't inside a string.
  let i = last;
  while (i < before.length) {
    const ch = before[i];
    if (ch === "'" || ch === '"') {
      i += 1;
      while (i < before.length && before[i] !== ch) i += before[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === "`") return i + 1;
    i += 1;
  }
  return null;
}

/** `text` with each `name` replaced by an equally long run of `0`s, so
 * GOQL completion reads it as a value without any position moving. */
export function maskColumnRefs(text: string): string {
  const { refs } = scanColumnRefs(text);
  let out = text;
  for (const ref of refs) out = out.slice(0, ref.start) + "0".repeat(ref.end - ref.start) + out.slice(ref.end);
  return out;
}

export interface NamedColumn {
  /** Stable id: a built-in column's key, a custom column's `goql_...`. */
  id: string;
  /** What the column's header says. */
  title: string;
  /** Other names it answers to (a built-in's untranslated label). */
  aliases: string[];
  expr: string;
  /** Kept in this browser only: can't be named in a shared rule. */
  browserOnly: boolean;
}

/** The columns `viewKey`'s GOQL can name. */
export function namedColumns(viewKey: string): NamedColumn[] {
  const view = VIEWS.find((v) => v.key === viewKey);
  if (!view) return [];
  const builtins = builtinColumns(view)
    .filter((c) => !c.hidden)
    .map((c) => ({ c, expr: columnExpression(c) }))
    // A select with its own alias (`... as is_gramplet`) isn't an expression.
    .filter(({ expr }) => !/\sas\s/.test(expr))
    .map(({ c, expr }) => ({ id: c.key, title: t(c.label), aliases: [c.label], expr, browserOnly: false }));
  const tree = getTreeColumns(viewKey);
  const treeIds = new Set(tree.map((c) => c.id));
  const custom = [
    ...tree.map((c) => ({ c, browserOnly: false })),
    ...listCustomColumns(viewKey)
      .filter((c) => !treeIds.has(c.id))
      .map((c) => ({ c, browserOnly: true })),
  ].map(({ c, browserOnly }) => ({
    id: c.id,
    title: c.title?.trim() || c.expr,
    aliases: [],
    expr: c.expr,
    browserOnly,
  }));
  return [...custom, ...builtins];
}

/** The column `name` refers to: by title first (ignoring case), then by
 * id. */
export function findNamedColumn(columns: NamedColumn[], name: string): NamedColumn | undefined {
  const lower = name.trim().toLowerCase();
  return (
    columns.find((c) => c.title.toLowerCase() === lower || c.aliases.some((a) => a.toLowerCase() === lower)) ??
    columns.find((c) => c.id === name.trim())
  );
}

function listLabel(viewKey: string): string {
  const view = VIEWS.find((v) => v.key === viewKey);
  return view ? t(view.label) : viewKey;
}

/** A plain path (`birth.place.title`), which can be read on from
 * (`Birth`.sortval) as it is. */
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\])*(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\])*)*$/;

/** `text` with every `name` replaced by its column's GOQL, in
 * parentheses -- or, when the name is read on from (`Birth`.sortval) and
 * the column is a plain path, by the path itself. Text with no backticks
 * comes back unchanged. Throws ColumnRefError for an unknown name, an
 * unclosed backtick, or (with `sharedOnly`) a column kept in this browser
 * only. */
export function expandColumnRefs(text: string, viewKey: string, { sharedOnly = false } = {}): string {
  if (!text.includes("`")) return text;
  const { refs, error } = scanColumnRefs(text);
  if (error) throw new ColumnRefError(error);
  if (refs.length === 0) return text;
  const columns = namedColumns(viewKey);
  let out = "";
  let at = 0;
  for (const ref of refs) {
    const column = findNamedColumn(columns, ref.name);
    if (!column) {
      throw new ColumnRefError(
        t("The {list} list has no column named `{name}`.").replace("{list}", listLabel(viewKey)).replace("{name}", ref.name),
      );
    }
    if (sharedOnly && column.browserOnly) {
      throw new ColumnRefError(
        t("`{name}` is only in this browser. A rule is shared with the tree, so it can only use columns shared with the tree.")
          .replace("{name}", column.title),
      );
    }
    const readOn = /^[.[]/.test(text.slice(ref.end));
    const expr = column.expr.trim();
    out += text.slice(at, ref.start) + (readOn && PATH_RE.test(expr) ? expr : `(${expr})`);
    at = ref.end;
  }
  return out + text.slice(at);
}

function renameRefs(text: string, rename: (name: string) => string | undefined): string {
  if (!text.includes("`")) return text;
  const { refs } = scanColumnRefs(text);
  let out = "";
  let at = 0;
  for (const ref of refs) {
    const name = rename(ref.name);
    out += text.slice(at, ref.start) + (name === undefined ? text.slice(ref.start, ref.end) : `\`${name}\``);
    at = ref.end;
  }
  return out + text.slice(at);
}

/** For storing a rule: each known column name replaced by the column's
 * id; unknown names are left as typed. */
export function columnRefsToIds(text: string, viewKey: string): string {
  const columns = namedColumns(viewKey);
  return renameRefs(text, (name) => findNamedColumn(columns, name)?.id);
}

/** For editing a stored rule: each column id shown as the column's
 * title. */
export function columnRefsToTitles(text: string, viewKey: string): string {
  const columns = namedColumns(viewKey);
  return renameRefs(text, (name) => columns.find((c) => c.id === name)?.title);
}
