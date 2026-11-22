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
/** A rendered piece, remembering whether its text came from a field's
 * value (never changed by cleanUp) or from the template itself. */
interface RenderedRun extends TemplateRun {
  value?: boolean;
}

/** One character of a rendered line, for cleanUp. */
interface Char {
  ch: string;
  italic: boolean;
  bold: boolean;
  /** From a field's value: cleanUp never removes it. */
  value: boolean;
}

const SEPARATORS = ",;:";
const CLOSING_QUOTES = "\"'”’";
const CLOSING_BRACKETS = ")]";
const PAIRS: Record<string, string> = { "(": ")", "[": "]", '"': '"', "“": "”" };

/** Tidies the punctuation a template leaves when some of its fields are
 * empty -- only characters the template wrote, never a field's value:
 * - a separator (, ; :) right after another one goes, with the space
 *   before it: '"Local News," , p. 3' -> '"Local News," p. 3';
 * - a separator at the end of the line goes, even inside a closing
 *   quote: '"Census, 1881,"' -> '"Census, 1881"';
 * - a separator right after an opening bracket, or right before a
 *   closing one, goes: '( , p. 3)' -> '(p. 3)', '(Leeds, )' -> '(Leeds)';
 * - an empty pair of brackets or quotes goes: '()', '[]', '""';
 * - double spaces become one. (A space before a separator stays: some
 *   styles want one, as in "URL : accessed".)
 * Repeats until nothing changes, since one fix can expose another. */
export function cleanUp(chars: Char[]): Char[] {
  let line = chars;
  for (let pass = 0; pass < 20; pass++) {
    const drop = new Set<number>();
    const tplSpace = (k: number) => line[k].ch === " " && !line[k].value;
    for (let i = 0; i < line.length; i++) {
      if (drop.has(i)) continue;
      const c = line[i];
      if (c.value) continue;
      if (SEPARATORS.includes(c.ch)) {
        // The nearest character before, past spaces and closing quotes.
        let back = i - 1;
        while (back >= 0 && line[back].ch === " ") back--;
        let prev = back;
        while (prev >= 0 && CLOSING_QUOTES.includes(line[prev].ch)) prev--;
        // The nearest character after, past spaces (then past quotes).
        let fwd = i + 1;
        while (fwd < line.length && line[fwd].ch === " ") fwd++;
        let next = fwd;
        while (next < line.length && CLOSING_QUOTES.includes(line[next].ch)) next++;
        const dropSpacesBetween = (from: number, to: number) => {
          for (let k = from; k < to; k++) if (tplSpace(k)) drop.add(k);
        };
        if (prev >= 0 && SEPARATORS.includes(line[prev].ch) && !drop.has(prev)) {
          drop.add(i);
          dropSpacesBetween(back + 1, i);
        } else if (next >= line.length) {
          drop.add(i);
          dropSpacesBetween(i + 1, fwd);
        } else if (CLOSING_BRACKETS.includes(line[fwd].ch)) {
          drop.add(i);
          dropSpacesBetween(back + 1, i);
          dropSpacesBetween(i + 1, fwd);
        } else if (back >= 0 && "([".includes(line[back].ch)) {
          drop.add(i);
          dropSpacesBetween(i + 1, fwd);
        }
        continue;
      }
      const closer = PAIRS[c.ch];
      if (closer) {
        let k = i + 1;
        while (k < line.length && line[k].ch === " ") k++;
        if (k < line.length && line[k].ch === closer && !line[k].value && k > i) {
          for (let m = i; m <= k; m++) if (!line[m].value) drop.add(m);
          continue;
        }
      }
      if (c.ch === " ") {
        const after = line[i + 1];
        if (after && after.ch === " ") drop.add(i);
      }
    }
    if (drop.size === 0) return line;
    line = line.filter((_, k) => !drop.has(k));
  }
  return line;
}

/** The line `nodes` make with `values` (expression -> formatted text,
 * "" or missing for no value), as styled runs: punctuation left by empty
 * fields tidied (cleanUp), trimmed, without empty runs, neighbours in the
 * same style merged. */
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
  ): RenderedRun[] | null => {
    const style = { ...start };
    const out: RenderedRun[] = [];
    const push = (text: string, fromValue: boolean) =>
      out.push({ text, italic: style.italic, bold: style.bold, value: fromValue });
    for (const node of list) {
      if (node.kind === "text") push(node.text, false);
      else if (node.kind === "style") style[node.style] = !style[node.style];
      else if (node.kind === "expr") {
        const v = value(node.expr);
        if (!v && droppable) return null;
        push(v, true);
      } else {
        const so_far = before + runsText(out);
        let inner = render(node.children, so_far, true, style) as RenderedRun[] | null;
        if (inner === null) continue;
        if (so_far.trim() === "") inner = stripLeadingSeparators(inner) as RenderedRun[];
        out.push(...inner);
      }
    }
    return out;
  };
  const rendered = render(nodes, "", false, { italic: false, bold: false }) ?? [];
  const chars = cleanUp(
    rendered.flatMap((run) =>
      [...run.text].map((ch) => ({ ch, italic: !!run.italic, bold: !!run.bold, value: !!run.value })),
    ),
  );
  // Back into runs, trimmed, neighbours in the same style merged.
  let first = 0;
  let last = chars.length - 1;
  while (first <= last && /\s/.test(chars[first].ch)) first++;
  while (last >= first && /\s/.test(chars[last].ch)) last--;
  const merged: TemplateRun[] = [];
  for (let k = first; k <= last; k++) {
    const c = chars[k];
    const prev = merged[merged.length - 1];
    if (prev && !!prev.italic === c.italic && !!prev.bold === c.bold) prev.text += c.ch;
    else merged.push({ text: c.ch, ...(c.italic ? { italic: true } : {}), ...(c.bold ? { bold: true } : {}) });
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
