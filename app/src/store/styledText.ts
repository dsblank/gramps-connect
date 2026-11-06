// Gramps StyledText <-> ProseMirror document JSON.
//
// A Gramps note's text is one flat string plus a list of tags, each a
// formatting type (gramps/gen/lib/styledtexttagtype.py: bold, italic,
// underline, strikethrough, superscript, subscript, fontface, fontsize,
// fontcolor, highlight, link) with a value and a list of [start, end)
// ranges. Ranges count Unicode code points (Python string indices), not
// JavaScript's UTF-16 units, so every offset here goes through
// Array.from(). This is the format Gramps desktop and gramps-web both read
// and write, and the only one stored: the ProseMirror document is just how
// the editor (NoteEditor.tsx) and the viewer (NoteText.tsx) work with it.
//
// Lines are paragraphs: each "\n" in the string ends one, so an unedited
// note converts back to exactly the same string. Gramps' own note editor
// has no other block structure (no headings or lists), so neither does the
// editor's schema.
//
// Inline images follow gramps-web's convention (its inlineImages.js): one
// U+FFFC character covered by a `link` tag to gramps://Media/handle/<h>.
// Gramps desktop shows that as a link to the media object.

export interface StyledTextTag {
  _class?: string;
  name: string;
  value: unknown;
  ranges: [number, number][];
}

export interface StyledText {
  _class?: string;
  string: string;
  tags?: StyledTextTag[];
}

export interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  marks?: PmMark[];
  text?: string;
}

export const IMAGE_PLACEHOLDER = "￼";

const MEDIA_LINK_RE = /^gramps:\/\/Media\/handle\/([^/#?]+)/;
const GRAMPS_LINK_RE = /^gramps:\/\/([A-Za-z]+)\/handle\/(.+)$/;

export function mediaLink(handle: string): string {
  return `gramps://Media/handle/${handle}`;
}

export function recordLink(objectClass: string, handle: string): string {
  return `gramps://${objectClass}/handle/${handle}`;
}

/** `gramps://Person/handle/<h>` -> {objectClass: "Person", handle}. */
export function parseGrampsLink(value: string): { objectClass: string; handle: string } | null {
  const m = GRAMPS_LINK_RE.exec(value);
  return m ? { objectClass: m[1], handle: m[2] } : null;
}

/** An external link this app is willing to make clickable. */
export function isSafeExternalUrl(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value.trim());
}

/** The Gramps tag types with no value (Gramps writes None for them). */
const BOOLEAN_TAGS: Record<string, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strike",
  superscript: "superscript",
  subscript: "subscript",
};
const MARK_TO_BOOLEAN_TAG: Record<string, string> = Object.fromEntries(
  Object.entries(BOOLEAN_TAGS).map(([tag, mark]) => [mark, tag])
);

/** Tag types whose value is kept as-is in the mark's `value` attribute. */
const VALUE_TAGS = new Set(["fontface", "fontsize", "fontcolor", "highlight"]);

/** Any other tag name survives as a `grampsTag` mark, so a tag type this
 * app doesn't know still moves with its text when the note is edited. */
export const UNKNOWN_TAG_MARK = "grampsTag";

function tagToMark(tag: StyledTextTag): PmMark {
  const name = String(tag.name);
  const boolMark = BOOLEAN_TAGS[name];
  if (boolMark) return { type: boolMark };
  if (VALUE_TAGS.has(name)) return { type: name, attrs: { value: tag.value } };
  if (name === "link") return { type: "link", attrs: { href: String(tag.value ?? "") } };
  return { type: UNKNOWN_TAG_MARK, attrs: { name, value: tag.value } };
}

function markToTag(mark: PmMark): { name: string; value: unknown } | null {
  const boolTag = MARK_TO_BOOLEAN_TAG[mark.type];
  if (boolTag) return { name: boolTag, value: null };
  if (VALUE_TAGS.has(mark.type)) return { name: mark.type, value: mark.attrs?.value ?? null };
  if (mark.type === "link") return { name: "link", value: String(mark.attrs?.href ?? "") };
  if (mark.type === UNKNOWN_TAG_MARK) return { name: String(mark.attrs?.name ?? ""), value: mark.attrs?.value ?? null };
  return null;
}

/** Gramps StyledText -> a ProseMirror `doc` (JSON), one paragraph a line. */
export function styledTextToDoc(text: StyledText | null | undefined): PmNode {
  const chars = Array.from(text?.string ?? "");
  const n = chars.length;
  const tags = (text?.tags ?? []).filter((t) => t && Array.isArray(t.ranges));

  // Every place where the set of active tags can change, plus both sides
  // of every newline (a newline is never part of a text node).
  const bounds = new Set<number>([0, n]);
  for (const tag of tags) {
    for (const [s, e] of tag.ranges) {
      bounds.add(Math.max(0, Math.min(n, s)));
      bounds.add(Math.max(0, Math.min(n, e)));
    }
  }
  chars.forEach((ch, i) => {
    if (ch === "\n") {
      bounds.add(i);
      bounds.add(i + 1);
    }
  });
  const sorted = [...bounds].sort((a, b) => a - b);

  const paragraphs: PmNode[] = [];
  let current: PmNode[] = [];
  const endParagraph = () => {
    paragraphs.push(current.length ? { type: "paragraph", content: current } : { type: "paragraph" });
    current = [];
  };

  for (let b = 0; b < sorted.length - 1; b++) {
    const start = sorted[b];
    const end = sorted[b + 1];
    if (start >= end) continue;
    const segment = chars.slice(start, end).join("");
    if (segment === "\n") {
      endParagraph();
      continue;
    }
    const active = tags.filter((t) => t.ranges.some(([s, e]) => s <= start && end <= e));
    // Inline image: a placeholder under a link to a Media object.
    const mediaTag = segment === IMAGE_PLACEHOLDER
      ? active.find((t) => String(t.name) === "link" && MEDIA_LINK_RE.test(String(t.value ?? "")))
      : undefined;
    // One mark per type (ProseMirror allows no more): a later tag of the
    // same type wins, the way it would display in Gramps.
    const byType = new Map<string, PmMark>();
    for (const tag of active) {
      if (tag === mediaTag) continue;
      const mark = tagToMark(tag);
      const key = mark.type === UNKNOWN_TAG_MARK ? `${mark.type}:${String(tag.name)}` : mark.type;
      byType.set(key, mark);
    }
    const marks = [...byType.values()];
    if (mediaTag) {
      const link = String(mediaTag.value);
      const node: PmNode = { type: "grampsImage", attrs: { handle: MEDIA_LINK_RE.exec(link)![1], link } };
      if (marks.length) node.marks = marks;
      current.push(node);
      continue;
    }
    const node: PmNode = { type: "text", text: segment };
    if (marks.length) node.marks = marks;
    current.push(node);
  }
  endParagraph();
  return { type: "doc", content: paragraphs };
}

/** A ProseMirror `doc` (JSON) -> Gramps StyledText. */
export function docToStyledText(doc: PmNode): StyledText {
  const parts: string[] = [];
  let pos = 0;
  const ranges = new Map<string, { name: string; value: unknown; ranges: [number, number][] }>();

  const addRange = (name: string, value: unknown, start: number, end: number) => {
    const key = `${name}\u0000${JSON.stringify(value ?? null)}`;
    let entry = ranges.get(key);
    if (!entry) {
      entry = { name, value: value ?? null, ranges: [] };
      ranges.set(key, entry);
    }
    entry.ranges.push([start, end]);
  };
  const addMarks = (marks: PmMark[] | undefined, start: number, end: number) => {
    for (const mark of marks ?? []) {
      const tag = markToTag(mark);
      if (tag && tag.name) addRange(tag.name, tag.value, start, end);
    }
  };

  const walkInline = (node: PmNode) => {
    if (node.type === "text") {
      const text = node.text ?? "";
      const len = Array.from(text).length;
      parts.push(text);
      addMarks(node.marks, pos, pos + len);
      pos += len;
    } else if (node.type === "hardBreak") {
      parts.push("\n");
      pos += 1;
    } else if (node.type === "grampsImage") {
      const link = String(node.attrs?.link || mediaLink(String(node.attrs?.handle ?? "")));
      parts.push(IMAGE_PLACEHOLDER);
      addRange("link", link, pos, pos + 1);
      addMarks(node.marks, pos, pos + 1);
      pos += 1;
    } else {
      for (const child of node.content ?? []) walkInline(child);
    }
  };

  (doc.content ?? []).forEach((block, i) => {
    if (i > 0) {
      parts.push("\n");
      pos += 1;
    }
    for (const child of block.content ?? []) walkInline(child);
  });

  const string = parts.join("");
  const chars = Array.from(string);
  const tags: StyledTextTag[] = [];
  for (const entry of ranges.values()) {
    tags.push({ _class: "StyledTextTag", name: entry.name, value: entry.value, ranges: mergeRanges(entry.ranges, chars) });
  }
  return { _class: "StyledText", string, tags };
}

/** Sorted, with touching or overlapping ranges joined -- and ranges with
 * only line breaks between them, since a newline is never inside a text
 * node: a tag Gramps stored across several lines comes back as one range,
 * not one per line. */
function mergeRanges(list: [number, number][], chars: string[]): [number, number][] {
  const sorted = [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  const onlyNewlines = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (chars[i] !== "\n") return false;
    return true;
  };
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && (s <= last[1] || onlyNewlines(last[1], s))) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** A Gramps color value as CSS, or undefined when it isn't one. Gramps
 * desktop has written both #rrggbb and GTK's 16-bit #rrrrggggbbbb; only
 * the display is normalized, the stored value is kept as it was. */
export function cssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  const long = /^#([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})$/i.exec(v);
  if (long) return `#${long[1].slice(0, 2)}${long[2].slice(0, 2)}${long[3].slice(0, 2)}`;
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : undefined;
}

/** A Gramps font size (points, an integer) as CSS. */
export function cssFontSize(value: unknown): string | undefined {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) && n > 0 && n < 200 ? `${n}pt` : undefined;
}

/** True when two StyledTexts hold the same text and formatting. */
export function sameStyledText(a: StyledText | null | undefined, b: StyledText | null | undefined): boolean {
  return styledTextKey(a) === styledTextKey(b);
}

function styledTextKey(t: StyledText | null | undefined): string {
  const tags = (t?.tags ?? [])
    .map((tag) => ({ n: String(tag.name), v: tag.value ?? null, r: tag.ranges }))
    .sort((x, y) => (x.n + JSON.stringify(x.v)).localeCompare(y.n + JSON.stringify(y.v)));
  return JSON.stringify({ s: t?.string ?? "", tags });
}
