// Fetches raw markdown from the gramps-connect.wiki GitHub repo, so
// DocumentationDialog.tsx can render wiki pages inside the app instead of
// just linking out to github.com (see MenuBar.tsx's Help > Documentation).
// raw.githubusercontent.com serves `access-control-allow-origin: *`, so this
// works as a plain browser fetch with no proxy or backend involvement --
// consistent with this project's preference for client-side-only solutions
// over gramps-web-api changes.
//
// English only for now (Phase 1 of the wiki-i18n plan). Translated sibling
// pages (e.g. Overview.fr.md) and language-aware fetching are a later phase.
const WIKI_RAW_BASE = "https://raw.githubusercontent.com/wiki/dsblank/gramps-connect";

const pageCache = new Map<string, string>();

export function wikiPageUrl(page: string): string {
  return `${WIKI_RAW_BASE}/${page}.md`;
}

export function wikiPageGithubUrl(page: string): string {
  return `https://github.com/dsblank/gramps-connect/wiki/${page}`;
}

export function wikiAssetUrl(relativePath: string): string {
  return `${WIKI_RAW_BASE}/${relativePath}`;
}

export async function fetchWikiPage(page: string): Promise<string> {
  const cached = pageCache.get(page);
  if (cached !== undefined) return cached;
  const res = await fetch(wikiPageUrl(page));
  if (!res.ok) throw new Error(`${page}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  pageCache.set(page, text);
  return text;
}
