// Citation templates: text with GOQL select expressions between backticks
// and optional parts in [...], rendered from what the server selects. This
// module is the syntax only -- no network, no display settings -- so
// displaySettings.ts can validate templates without an import cycle;
// citationTemplate.ts does the server side.
//
//   `author`[, "`title`"][, `pubinfo`][, (`abbrev`)]
//
// - `expr` is a GOQL select expression, evaluated server-side against a
//   Source (the source line) or a Citation (the citation line), so links
//   (`repositories[0].name`, `source.title`) and attributes
//   (`attribute_list['Film'].value`) work as in List Columns.
// - [...] is dropped when any expression directly inside it is empty.
//   Groups nest; an inner group's emptiness doesn't drop the outer one.
// - Separators at the start of a group (spaces , ; : . and dashes) are
//   left out when nothing has been written before the group on its line,
//   Gramps' "add ', ' only after something" rule. A "(" or a quote stays.
// - \ makes the next character plain text: \` \[ \] \\.
//
// Legacy and Enhanced stay TypeScript formatters (citationFormat.ts: no
// request, Gramps' translated separators); LEGACY_TEMPLATE and
// ENHANCED_TEMPLATE are the same formats written as templates, the
// starting point for a tree's own.
import { t } from "../i18n/i18n";

export type TemplateNode =
  | { kind: "text"; text: string }
  | { kind: "expr"; expr: string; column: number }
  | { kind: "group"; children: TemplateNode[]; column: number };

/** A template that doesn't parse; `column` is 1-based. */
export class TemplateError extends Error {
  constructor(message: string, readonly column: number) {
    super(message);
  }
}

export interface CitationTemplate {
  /** Written against the Source. */
  source: string;
  /** Written against the Citation. */
  citation: string;
}

/** Gramps' own format, as citationFormat.ts writes it in English. */
export const LEGACY_TEMPLATE: CitationTemplate = {
  source: '`author`[, "`title`"][, `pubinfo`][, (`abbrev`)]',
  citation: "`page`[ - `date`][ \\[`confidence`\\]]",
};

/** The CiteEnhanced addon: Legacy, starting with the first repository. */
export const ENHANCED_TEMPLATE: CitationTemplate = {
  source:
    '[`repositories[0].name`][ \\[`reporef_list[0].call_number`\\]][, `author`][, "`title`"][, `pubinfo`][, (`abbrev`)]',
  citation: LEGACY_TEMPLATE.citation,
};

export function parseTemplate(source: string): TemplateNode[] {
  const root: TemplateNode[] = [];
  const stack: { children: TemplateNode[]; column: number }[] = [{ children: root, column: 0 }];
  let text = "";
  const flush = () => {
    if (text) stack[stack.length - 1].children.push({ kind: "text", text });
    text = "";
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      if (i + 1 >= source.length) throw new TemplateError(t("A \\ at the end has nothing to make plain"), i + 1);
      text += source[++i];
    } else if (ch === "`") {
      const end = source.indexOf("`", i + 1);
      if (end < 0) throw new TemplateError(t("This ` is never closed"), i + 1);
      const expr = source.slice(i + 1, end).trim();
      if (!expr) throw new TemplateError(t("Empty `` -- write a GOQL expression between the backticks"), i + 1);
      flush();
      stack[stack.length - 1].children.push({ kind: "expr", expr, column: i + 2 });
      i = end;
    } else if (ch === "[") {
      flush();
      const group = { kind: "group" as const, children: [] as TemplateNode[], column: i + 1 };
      stack[stack.length - 1].children.push(group);
      stack.push(group);
    } else if (ch === "]") {
      if (stack.length === 1) throw new TemplateError(t("This ] has no [ before it"), i + 1);
      flush();
      stack.pop();
    } else {
      text += ch;
    }
  }
  if (stack.length > 1) throw new TemplateError(t("This [ is never closed"), stack[stack.length - 1].column);
  flush();
  return root;
}

/** Every distinct expression in `nodes`, in order of first use. */
export function templateExpressions(nodes: TemplateNode[]): string[] {
  const seen = new Set<string>();
  const walk = (list: TemplateNode[]) => {
    for (const node of list) {
      if (node.kind === "expr") seen.add(node.expr);
      else if (node.kind === "group") walk(node.children);
    }
  };
  walk(nodes);
  return [...seen];
}

const LEADING_SEPARATORS = /^[\s,;:.\-–—]+/;

/** The line `nodes` make with `values` (expression -> formatted text,
 * "" or missing for no value). */
export function renderTemplate(nodes: TemplateNode[], values: ReadonlyMap<string, string>): string {
  const value = (expr: string) => values.get(expr) ?? "";
  // Null when a group must be dropped; the top level never is.
  const render = (list: TemplateNode[], before: string, droppable: boolean): string | null => {
    let out = "";
    for (const node of list) {
      if (node.kind === "text") out += node.text;
      else if (node.kind === "expr") {
        const v = value(node.expr);
        if (!v && droppable) return null;
        out += v;
      } else {
        let inner = render(node.children, before + out, true);
        if (inner === null) continue;
        if ((before + out).trim() === "") inner = inner.replace(LEADING_SEPARATORS, "");
        out += inner;
      }
    }
    return out;
  };
  return (render(nodes, "", false) ?? "").trim();
}

/** Where the GOQL expression around `cursor` sits in a template, for Tab
 * completion: between the backtick before the cursor and the next one
 * (or the end). Null outside backticks. */
export function locateTemplateExpression(value: string, cursor: number): { source: string; offset: number } | null {
  let open: number | null = null;
  for (let i = 0; i < cursor; i++) {
    if (value[i] === "\\" && open === null) i++;
    else if (value[i] === "`") open = open === null ? i : null;
  }
  if (open === null) return null;
  const close = value.indexOf("`", cursor);
  const end = close < 0 ? value.length : close;
  return { source: value.slice(open + 1, end), offset: open + 1 };
}
