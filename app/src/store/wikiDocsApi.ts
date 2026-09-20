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
// proof of concept) -- fetchWikiPage just tries the translated filename
// (falling back from a regional locale like "de_AT" to its base language
// "de", then to English on any failure) silently, so the caller never needs
// to know whether a translation existed.
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

  // Try the exact locale, then its base language (e.g. "de_AT" -> "de")
  // before giving up to English -- same fallback order as i18n.ts's own
  // detectBrowserLang(), since a wiki translation only ever exists per
  // base language, never per region.
  const base = lang.split("_")[0];
  const candidates = base !== lang ? [lang, base] : [lang];
  for (const candidate of candidates) {
    if (candidate === "en") break;
    try {
      const markdown = await fetchRaw(page, candidate);
      const result = { markdown, lang: candidate };
      pageCache.set(cacheKey, result);
      return result;
    } catch {
      // No translation for this page/language yet -- try the next
      // candidate, or fall through to English below.
    }
  }

  const result = { markdown: await fetchRaw(page, "en"), lang: "en" };
  // Cache only under the English key, not `cacheKey` -- caching the
  // fallback under the requested language too would permanently "poison"
  // that page/language pair for the rest of the session on any transient
  // failure (or a request racing a not-yet-propagated wiki push), even
  // once the translation becomes available. Retrying costs one extra
  // request per view of an untranslated page, which is an acceptable
  // trade-off at this scale.
  pageCache.set(`${page}:en`, result);
  return result;
}
