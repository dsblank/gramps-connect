// Full-text search over the wiki, for DocumentationDialog.tsx's search box.
// GitHub wikis have no real content search, so this is in-app only: the
// first search in a language fetches every page the sidebar lists (via
// fetchWikiPage, so each page falls back to English on its own when it has
// no translation yet), splits them at their headings, and keeps the
// sections in memory for the rest of the session. The wiki is a few
// hundred sections, so a plain scan per keystroke is fast enough and no
// search library is needed.
//
// Matching has to work in every language the app runs in:
//  - case and accents are folded away ("eintrage" finds "Einträge");
//  - words come from Intl.Segmenter, so punctuation and spacing rules are
//    the language's own;
//  - Chinese, Japanese and Korean are matched as substrings instead, since
//    their text has no spaces between words and the segmenter splits a
//    phrase like 叠加层 into single characters.
import { Lexer } from "marked";
import { fetchWikiPage } from "./wikiDocsApi";
import { githubSlug, splitWikiTarget } from "./wikiMarkdown";

export interface WikiSection {
  page: string;
  /** The page's own `#` title, shown with every result from that page. */
  pageTitle: string;
  /** Null for the text before a page's first `##` heading. */
  heading: string | null;
  /** What DocumentationDialog's pendingAnchor should jump to: a translated
   * heading's explicit English `<a id>`, else the heading's GitHub slug
   * (de-duplicated as renderWikiMarkdown does). Null means "top of page". */
  anchor: string | null;
  /** Language the page actually resolved to ("en" when not translated). */
  lang: string;
  text: string;
  // Precomputed for matching:
  headingWords: string[];
  words: string[];
  foldedHeading: string;
  foldedText: string;
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface WikiSearchResult {
  section: WikiSection;
  score: number;
  snippet: SnippetPart[];
}

const SIDEBAR_PAGE = "_Sidebar";
const SNIPPET_LENGTH = 180;
// Characters, so a CJK snippet holds several times more words.
const CJK_SNIPPET_LENGTH = 80;
const MAX_RESULTS = 50;

/** Lowercase, with accents and other combining marks removed. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function segmenter(lang: string): Intl.Segmenter | null {
  try {
    return new Intl.Segmenter(lang.replace("_", "-"), { granularity: "word" });
  } catch {
    return null;
  }
}

/** The words of `text`, in order, as they appear (not folded). */
function wordsOf(text: string, lang: string): string[] {
  const seg = segmenter(lang);
  if (!seg) return text.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  return [...seg.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
}

/** Markdown down to the text a reader sees. Rough on purpose: the result is
 * only searched and shown as a short snippet, never rendered. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\|?[-:| ]+\|[-:| ]*$/gm, " ")
    .replace(/[|*`#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXPLICIT_ANCHOR_RE = /<a id="([^"]+)"><\/a>/;

/** One page's sections, split at its `##`-and-deeper headings. Headings
 * inside code blocks are left alone (marked's lexer knows the difference). */
export function splitWikiSections(markdown: string, page: string, lang: string): WikiSection[] {
  const tokens = Lexer.lex(markdown);
  const sections: WikiSection[] = [];
  const seenSlugs = new Map<string, number>();
  let pageTitle = page.replace(/-/g, " ");
  let current = { heading: null as string | null, anchor: null as string | null, parts: [] as string[] };

  const flush = () => {
    const text = plainText(current.parts.join("\n"));
    if (!text && current.heading === null) return;
    const heading = current.heading;
    sections.push({
      page,
      pageTitle,
      heading,
      anchor: current.anchor,
      lang,
      text,
      headingWords: wordsOf(heading ?? "", lang).map(fold),
      words: wordsOf(text, lang).map(fold),
      foldedHeading: fold(heading ?? ""),
      foldedText: fold(text),
    });
  };

  for (const token of tokens) {
    if (token.type === "heading") {
      const raw: string = token.text;
      const headingText = plainText(raw);
      const slug = githubSlug(headingText);
      const count = seenSlugs.get(slug) ?? 0;
      seenSlugs.set(slug, count + 1);
      if (token.depth === 1) {
        pageTitle = headingText;
        continue;
      }
      flush();
      const explicit = EXPLICIT_ANCHOR_RE.exec(raw)?.[1];
      current = { heading: headingText, anchor: explicit ?? (count === 0 ? slug : `${slug}-${count}`), parts: [] };
    } else if (token.type === "code") {
      current.parts.push(token.text);
    } else if (token.type !== "html" && token.type !== "space") {
      current.parts.push(token.raw);
    }
  }
  flush();
  return sections;
}

/** Page names the sidebar links to, in sidebar order, without any ".lang"
 * suffix. Only bare wiki page links count -- not the GitHub repo link. */
export function wikiPagesFromNav(markdown: string): string[] {
  const pages: string[] = [];
  for (const match of markdown.matchAll(/\]\(([A-Za-z0-9_.-]+)(?:#[^)]*)?\)/g)) {
    const { page } = splitWikiTarget(match[1]);
    if (!pages.includes(page)) pages.push(page);
  }
  return pages;
}

const indexCache = new Map<string, Promise<WikiSection[]>>();

/** Every section of every sidebar page, in `lang` where translated. Built
 * once per language per session; a page that fails to load is just left
 * out rather than failing the whole index. A failed build isn't cached, so
 * the next search tries again. */
export function loadWikiIndex(lang: string): Promise<WikiSection[]> {
  let index = indexCache.get(lang);
  if (!index) {
    index = (async () => {
      const nav = await fetchWikiPage(SIDEBAR_PAGE, lang);
      const pages = wikiPagesFromNav(nav.markdown);
      const loaded = await Promise.allSettled(pages.map((page) => fetchWikiPage(page, lang)));
      return loaded.flatMap((result, i) =>
        result.status === "fulfilled" ? splitWikiSections(result.value.markdown, pages[i], result.value.lang) : [],
      );
    })();
    index.catch(() => indexCache.delete(lang));
    indexCache.set(lang, index);
  }
  return index;
}

interface QueryTerm {
  folded: string;
  /** Lowercased but not folded, for finding the term's position in the
   * original text (folding decomposes Hangul syllables, for one). */
  raw: string;
  /** CJK terms match anywhere in the text; others only at a word start. */
  substring: boolean;
}

/** A CJK run in the query stays one phrase; everything else is split into
 * words the same way the sections were. */
export function queryTerms(query: string, lang: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  for (const chunk of query.trim().split(/\s+/).filter(Boolean)) {
    if (CJK_RE.test(chunk)) {
      terms.push({ folded: fold(chunk), raw: chunk.toLowerCase(), substring: true });
    } else {
      for (const word of wordsOf(chunk, lang)) terms.push({ folded: fold(word), raw: word.toLowerCase(), substring: false });
    }
  }
  return terms;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

/** Score of one term in one section, 0 when it doesn't match at all.
 * A heading match counts far more than body text, and a whole word more
 * than a prefix ("merge" vs "merged"). */
function termScore(term: QueryTerm, section: WikiSection): number {
  if (term.substring) {
    const inHeading = section.foldedHeading.includes(term.folded) ? 10 : 0;
    const inText = Math.min(countOccurrences(section.foldedText, term.folded), 5);
    return inHeading + inText;
  }
  let score = 0;
  for (const word of section.headingWords) {
    if (word === term.folded) score += 12;
    else if (word.startsWith(term.folded)) score += 8;
  }
  let body = 0;
  for (const word of section.words) {
    if (word === term.folded) body += 1.5;
    else if (word.startsWith(term.folded)) body += 1;
  }
  return score + Math.min(body, 6);
}

/** Every section matching all of the query's terms, best first. */
export function searchWikiSections(sections: WikiSection[], query: string, lang: string): WikiSearchResult[] {
  const terms = queryTerms(query, lang);
  if (terms.length === 0) return [];
  const results: WikiSearchResult[] = [];
  for (const section of sections) {
    let score = 0;
    let all = true;
    for (const term of terms) {
      const s = termScore(term, section);
      if (s === 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (!all) continue;
    if (terms.some((t) => fold(section.pageTitle).includes(t.folded))) score += 2;
    results.push({ section, score, snippet: snippetFor(section, terms) });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}

/** Does this piece of original text match a term? Compared folded, so the
 * snippet can show the text as written while matching it the way search
 * does. */
function matchesTerm(piece: string, terms: QueryTerm[]): boolean {
  const folded = fold(piece);
  return terms.some((t) => (t.substring ? folded.includes(t.folded) : folded.startsWith(t.folded)));
}

/** About SNIPPET_LENGTH (or CJK_SNIPPET_LENGTH) characters of the section's text around its first
 * match, split into plain and matching parts for the caller to highlight.
 * Built from the original text segment by segment, so folding (which can
 * change a string's length) never throws the highlight off. */
export function snippetFor(section: WikiSection, terms: QueryTerm[]): SnippetPart[] {
  const text = section.text;
  if (!text) return [];
  const length = /^(zh|ja|ko)/.test(section.lang) ? CJK_SNIPPET_LENGTH : SNIPPET_LENGTH;
  const marked = markPieces(text, terms, section.lang);
  const firstMatch = marked.find((p) => p.match)?.start ?? -1;

  const from = Math.max(0, (firstMatch === -1 ? 0 : firstMatch) - length / 3);
  const to = from + length;
  const window = marked.filter((p) => p.start + p.text.length > from && p.start < to);
  const parts: SnippetPart[] = [];
  for (const p of window) {
    const last = parts[parts.length - 1];
    if (last && last.match === p.match) last.text += p.text;
    else parts.push({ text: p.text, match: p.match });
  }
  if (parts.length > 0) {
    if (from > 0) parts[0].text = `…${parts[0].text.trimStart()}`;
    if (to < text.length) parts[parts.length - 1].text = `${parts[parts.length - 1].text.trimEnd()}…`;
  }
  return parts;
}

/** `text` cut into word and non-word pieces, each marked by whether it
 * matches a term -- the same rules search uses, applied to the text as
 * written. Shared by snippets and by highlighting the page itself. */
function markPieces(text: string, terms: QueryTerm[], lang: string): { text: string; match: boolean; start: number }[] {
  const seg = segmenter(lang);
  const pieces = seg
    ? [...seg.segment(text)].map((s) => ({ text: s.segment, word: Boolean(s.isWordLike) }))
    : text.split(/([^\p{L}\p{N}_]+)/u).map((p, i) => ({ text: p, word: i % 2 === 0 }));

  // A CJK phrase can span several segments, so find it by position instead.
  const cjkHits = substringHits(text, terms.filter((t) => t.substring));
  const wordTerms = terms.filter((t) => !t.substring);

  let offset = 0;
  return pieces.map((p) => {
    const start = offset;
    offset += p.text.length;
    const inCjkHit = cjkHits.some((hit) => start < hit.end && offset > hit.start);
    return { text: p.text, match: inCjkHit || (p.word && matchesTerm(p.text, wordTerms)), start };
  });
}

const HIGHLIGHT_ATTR = "data-wiki-search-match";

/** Wrap every match of `query` in the rendered page under `root` in a
 * <mark>, after removing any earlier highlighting. An empty query just
 * removes it. Works on text nodes, so links and other markup around the
 * matches are left as they are. */
export function highlightWikiMatches(root: HTMLElement, query: string, lang: string): void {
  for (const mark of root.querySelectorAll(`mark[${HIGHLIGHT_ATTR}]`)) {
    mark.replaceWith(...mark.childNodes);
  }
  root.normalize();
  const terms = queryTerms(query, lang);
  if (terms.length === 0) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node as Text);
  for (const node of textNodes) {
    const pieces = markPieces(node.data, terms, lang);
    if (!pieces.some((p) => p.match)) continue;
    const fragment = document.createDocumentFragment();
    for (const piece of pieces) {
      if (piece.match) {
        const mark = document.createElement("mark");
        mark.setAttribute(HIGHLIGHT_ATTR, "");
        mark.textContent = piece.text;
        fragment.appendChild(mark);
      } else {
        fragment.appendChild(document.createTextNode(piece.text));
      }
    }
    node.replaceWith(fragment);
  }
}

/** Every place a CJK term occurs in `text`, found by its unfolded form so
 * the positions are in the original string. */
function substringHits(text: string, terms: QueryTerm[]): { start: number; end: number }[] {
  const lower = text.toLowerCase();
  const hits: { start: number; end: number }[] = [];
  for (const term of terms) {
    for (let i = lower.indexOf(term.raw); i !== -1; i = lower.indexOf(term.raw, i + term.raw.length)) {
      hits.push({ start: i, end: i + term.raw.length });
    }
  }
  return hits;
}
