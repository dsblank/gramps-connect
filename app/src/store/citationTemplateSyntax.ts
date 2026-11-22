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
// - *text* is italic and **text** bold. Only the template's own text is
//   read for markers, never a value; a marker must be closed in the same
//   [ ] part it was opened in.
// - \ makes the next character plain text: \` \[ \] \* \\.
//
// Legacy and Enhanced stay TypeScript formatters (citationFormat.ts: no
// request, Gramps' translated separators); LEGACY_TEMPLATE and
// ENHANCED_TEMPLATE are the same formats written as templates, the
// starting point for a tree's own.
import { t } from "../i18n/i18n";

export type TemplateStyle = "italic" | "bold";

export type TemplateNode =
  | { kind: "text"; text: string }
  | { kind: "expr"; expr: string; column: number }
  | { kind: "group"; children: TemplateNode[]; column: number }
  /** `*` (italic) or `**` (bold): turns that style on, or off again. */
  | { kind: "style"; style: TemplateStyle; column: number };

/** A piece of a rendered line, in one style. */
export interface TemplateRun {
  text: string;
  italic?: boolean;
  bold?: boolean;
}

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

/** A ready-made template to start a tree's own from. */
export interface StarterTemplate extends CitationTemplate {
  name: string;
  /** What it's for, shown where it's offered. */
  description: string;
}

/** Layered source citations for common kinds of record, offered under
 * the template editor's "Start from". They use Gramps' own fields where
 * there is one and these attributes for the rest (see the Citations wiki
 * page): Place, Medium and Original on the Source; Item, URL, Accessed and
 * Film on the Citation. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: "Online record",
    description: "A record seen on a website: FamilySearch, Ancestry, FindMyPast, FreeBMD, Find a Grave, an online index",
    source: "\"`title`,\"[ `attribute_list['Medium'].value`,][ *`repositories[0].name`*]",
    citation:
      "[`attribute_list['Item'].value`][ (`attribute_list['URL'].value`[ : accessed `attribute_list['Accessed'].value`])][; citing `source.attribute_list['Original'].value`][, `page`]",
  },
  {
    name: "Archive record",
    description: "A census, parish register or civil register seen in an archive or on microfilm",
    source: "`title`[, `attribute_list['Place'].value`][; `repositories[0].name`][, `reporef_list[0].call_number`]",
    citation: "[`attribute_list['Item'].value`][, `page`][ (`date`)][; microfilm `attribute_list['Film'].value`]",
  },
  {
    name: "Book",
    description: "A printed book: author, title and publication details",
    source: "[`author`, ]*`title`*[ (`pubinfo`)]",
    citation: "[`page`]",
  },
  {
    name: "Newspaper",
    description: "A newspaper article, in print or in an online archive",
    source: "*`title`*[ (`attribute_list['Place'].value`)]",
    citation:
      "[\"`attribute_list['Item'].value`,\" ][`date`][, `page`][ (`attribute_list['URL'].value`[ : accessed `attribute_list['Accessed'].value`])]",
  },
  {
    name: "Gravestone",
    description: "A gravestone or memorial, seen or photographed",
    source: "`title`[, `attribute_list['Place'].value`]",
    citation: "[`attribute_list['Item'].value`][, `page`][, photographed `date`]",
  },
];

export function parseTemplate(source: string): TemplateNode[] {
  const root: TemplateNode[] = [];
  // Each level (the line, then each open [ ]) tracks the styles turned on
  // in it: a style must be turned off again in the same part, so dropping
  // an optional part never leaves one half open.
  type Level = { children: TemplateNode[]; column: number; open: Map<TemplateStyle, number> };
  const stack: Level[] = [{ children: root, column: 0, open: new Map() }];
  let text = "";
  const top = () => stack[stack.length - 1];
  const flush = () => {
    if (text) top().children.push({ kind: "text", text });
    text = "";
  };
  const unclosedStyle = (level: Level) => {
    const [style, column] = [...level.open.entries()].sort((x, y) => x[1] - y[1])[0];
    return new TemplateError(
      style === "bold"
        ? t("This ** is never closed in its part of the template")
        : t("This * is never closed in its part of the template"),
      column,
    );
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
      top().children.push({ kind: "expr", expr, column: i + 2 });
      i = end;
    } else if (ch === "*") {
      const style: TemplateStyle = source[i + 1] === "*" ? "bold" : "italic";
      flush();
      top().children.push({ kind: "style", style, column: i + 1 });
      const open = top().open;
      if (open.has(style)) open.delete(style);
      else open.set(style, i + 1);
      if (style === "bold") i++;
    } else if (ch === "[") {
      flush();
      const group = { kind: "group" as const, children: [] as TemplateNode[], column: i + 1 };
      top().children.push(group);
      stack.push({ children: group.children, column: i + 1, open: new Map() });
    } else if (ch === "]") {
      if (stack.length === 1) throw new TemplateError(t("This ] has no [ before it"), i + 1);
      flush();
      if (top().open.size) throw unclosedStyle(top());
      stack.pop();
    } else {
      text += ch;
    }
  }
  if (stack.length > 1) throw new TemplateError(t("This [ is never closed"), top().column);
  flush();
  if (top().open.size) throw unclosedStyle(top());
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

const runsText = (runs: TemplateRun[]) => runs.map((r) => r.text).join("");

/** `runs` with leading separators (see the module comment) left out. */
function stripLeadingSeparators(runs: TemplateRun[]): TemplateRun[] {
  const out = [...runs];
  while (out.length) {
    const stripped = out[0].text.replace(LEADING_SEPARATORS, "");
    if (stripped) {
      out[0] = { ...out[0], text: stripped };
      break;
    }
    // A run of nothing but separators goes; the next may start with more.
    out.shift();
  }
  return out;
}

/** The line `nodes` make with `values` (expression -> formatted text,
 * "" or missing for no value), as styled runs: trimmed, without empty
 * runs, neighbours in the same style merged. */
export function renderTemplateRuns(nodes: TemplateNode[], values: ReadonlyMap<string, string>): TemplateRun[] {
  const value = (expr: string) => values.get(expr) ?? "";
  // Null when a group must be dropped; the top level never is. `style` is
  // the style in effect where `list` starts; a group's own markers are
  // balanced (parseTemplate), so it ends in the style it started with.
  const render = (
    list: TemplateNode[],
    before: string,
    droppable: boolean,
    start: { italic: boolean; bold: boolean },
  ): TemplateRun[] | null => {
    const style = { ...start };
    const out: TemplateRun[] = [];
    const push = (text: string) => out.push({ text, italic: style.italic, bold: style.bold });
    for (const node of list) {
      if (node.kind === "text") push(node.text);
      else if (node.kind === "style") style[node.style] = !style[node.style];
      else if (node.kind === "expr") {
        const v = value(node.expr);
        if (!v && droppable) return null;
        push(v);
      } else {
        const so_far = before + runsText(out);
        let inner = render(node.children, so_far, true, style);
        if (inner === null) continue;
        if (so_far.trim() === "") inner = stripLeadingSeparators(inner);
        out.push(...inner);
      }
    }
    return out;
  };
  const runs = (render(nodes, "", false, { italic: false, bold: false }) ?? []).filter((r) => r.text);
  if (runs.length) {
    runs[0] = { ...runs[0], text: runs[0].text.trimStart() };
    const last = runs.length - 1;
    runs[last] = { ...runs[last], text: runs[last].text.trimEnd() };
  }
  const merged: TemplateRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && !!prev.italic === !!run.italic && !!prev.bold === !!run.bold) prev.text += run.text;
    else merged.push({ text: run.text, ...(run.italic ? { italic: true } : {}), ...(run.bold ? { bold: true } : {}) });
  }
  return merged;
}

/** The line as plain text (styles dropped). */
export function renderTemplate(nodes: TemplateNode[], values: ReadonlyMap<string, string>): string {
  return runsText(renderTemplateRuns(nodes, values));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Lines of runs as plain text, one line each. */
export function linesToText(lines: TemplateRun[][]): string {
  return lines.map(runsText).join("\n");
}

/** Lines of runs as HTML (<i>, <b>, <br>), for a rich copy. */
export function linesToHtml(lines: TemplateRun[][]): string {
  return lines
    .map((runs) =>
      runs
        .map((r) => {
          let html = escapeHtml(r.text);
          if (r.italic) html = `<i>${html}</i>`;
          if (r.bold) html = `<b>${html}</b>`;
          return html;
        })
        .join(""),
    )
    .join("<br>");
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
