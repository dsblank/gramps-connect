// Fetches raw markdown from the gramps-connect.wiki GitHub repo, so
// DocumentationDialog.tsx can render wiki pages inside the app instead of
// just linking out to github.com (see MenuBar.tsx's Help > Documentation).
// raw.githubusercontent.com serves `access-control-allow-origin: *`, so this
// works as a plain browser fetch with no proxy or backend involvement --
// consistent with this project's preference for client-side-only solutions
// over gramps-web-api changes.
//
// Translated pages (Phase 2 of the wiki-i18n plan) live as ordinary sibling
// wiki pages, "{Page}.{lang}.md" (e.g. Home.de.md), committed alongside the
// English original in the same wiki repo -- no separate hosting, and they
// stay real, browsable GitHub wiki pages in their own right. There's no
// manifest of which (page, lang) pairs exist yet (only a handful do, as a
// proof of concept) -- fetchWikiPage just tries the translated filename and
// falls back to English on any failure (404, or no such language at all),
// silently, so the caller never needs to know whether a translation existed.
const WIKI_RAW_BASE = "https://raw.githubusercontent.com/wiki/dsblank/gramps-connect";

export interface WikiPage {
  markdown: string;
  /** "en" unless a "{page}.{lang}.md" translation was actually found. */
  lang: string;
}

const pageCache = new Map<string, WikiPage>();

function wikiPageFilename(page: string, lang: string): string {
  return lang === "en" ? `${page}.md` : `${page}.${lang}.md`;
}

export function wikiPageUrl(page: string, lang = "en"): string {
  return `${WIKI_RAW_BASE}/${wikiPageFilename(page, lang)}`;
}

/** The real GitHub wiki page name for a resolved (page, lang) pair -- a
 * translated file's own slug, e.g. "Home.de", not the English one. */
export function wikiPageGithubUrl(page: string, lang = "en"): string {
  const slug = lang === "en" ? page : `${page}.${lang}`;
  return `https://github.com/dsblank/gramps-connect/wiki/${slug}`;
}

export function wikiAssetUrl(relativePath: string): string {
  return `${WIKI_RAW_BASE}/${relativePath}`;
}

async function fetchRaw(page: string, lang: string): Promise<string> {
  const res = await fetch(wikiPageUrl(page, lang));
  if (!res.ok) throw new Error(`${wikiPageFilename(page, lang)}: ${res.status} ${res.statusText}`);
  return res.text();
}

export async function fetchWikiPage(page: string, lang = "en"): Promise<WikiPage> {
  const cacheKey = `${page}:${lang}`;
  const cached = pageCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (lang !== "en") {
    try {
      const markdown = await fetchRaw(page, lang);
      const result = { markdown, lang };
      pageCache.set(cacheKey, result);
      return result;
    } catch {
      // No translation for this page/language yet -- fall through to
      // English below, same as any other untranslated page.
    }
  }

  const markdown = await fetchRaw(page, "en");
  const result = { markdown, lang: "en" };
  pageCache.set(cacheKey, result);
  pageCache.set(`${page}:en`, result);
  return result;
}
