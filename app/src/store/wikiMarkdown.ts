import DOMPurify from "dompurify";
import { Marked } from "marked";
import { wikiAssetUrl } from "./wikiDocsApi";

/** Bare page name ("Overview", "Data-Model-and-Editing", optionally with a
 * "#fragment") -> wiki-internal navigation; anything with a scheme, a leading
 * "/", or a "/" in it (asset paths like "images/x.png", or a real external
 * URL) is left as a normal link/asset reference instead. A bare "#fragment"
 * is handled separately, as a jump within the current page. Matches how
 * every page in ../../../gramps-connect.wiki actually writes its links
 * (checked: no `[[wiki-link]]` syntax anywhere, just plain markdown). */
function isInternalWikiLink(href: string): boolean {
  return !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href) && !href.split("#")[0].includes("/");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** "Overview.es" -> { page: "Overview", lang: "es" }; a bare "Overview"
 * has no language of its own (lang null) and follows whatever language the
 * reader is viewing. Translated pages link to their own language's siblings
 * so GitHub readers stay in it, and the "available in" banner names each
 * language explicitly. No English page name contains a ".", so anything
 * after one is a locale ("es", "pt_BR", "zh_CN"). */
export function splitWikiTarget(target: string): { page: string; lang: string | null } {
  const match = /^(.*)\.([a-z]{2,3}(?:_[A-Za-z]{2,4})?)$/.exec(target);
  return match ? { page: match[1], lang: match[2] } : { page: target, lang: null };
}

const BANNER_RE = /<!-- wiki-i18n:available-in:start -->[\s\S]*?<!-- wiki-i18n:available-in:end -->/;

/** Inside the "available in" banner (written by
 * scripts/sync-wiki-translations.py), the bare `[English](Home)` link means
 * English specifically, not "the current language" like a bare body link --
 * otherwise clicking it from a translation would go nowhere. */
function markBannerEnglish(markdown: string): string {
  return markdown.replace(BANNER_RE, (banner) => banner.replace(/\]\(([A-Za-z0-9_-]+)\)/g, "]($1.en)"));
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** GitHub's heading-anchor slug (github-slugger), so `Page#some-heading`
 * links written for the real wiki land on the same heading here. Mirrors
 * github_slug() in scripts/sync-wiki-translations.py, which stamps these
 * English slugs onto translated headings as explicit `<a id>` anchors. */
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/** Fresh Marked instance per render so the link/image overrides can close
 * over the sanitize step below rather than mutating shared global state.
 * Internal links carry their target as `data-wiki-page` (empty for a
 * same-page "#fragment") plus `data-wiki-lang` when the link names a
 * language and `data-wiki-anchor`; DocumentationDialog handles the click. Headings get GitHub-style ids for those anchors to
 * find. */
export function renderWikiMarkdown(markdown: string): string {
  const marked = new Marked({
    renderer: {
      link({ href, title, text }) {
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        if (href.startsWith("#") || isInternalWikiLink(href)) {
          const [target, anchor = ""] = href.split("#", 2);
          const { page, lang } = splitWikiTarget(target);
          const langAttr = lang ? ` data-wiki-lang="${escapeAttr(lang)}"` : "";
          const anchorAttr = anchor ? ` data-wiki-anchor="${escapeAttr(safeDecode(anchor))}"` : "";
          return `<a href="#" data-wiki-page="${escapeAttr(page)}"${langAttr}${anchorAttr}${titleAttr}>${text}</a>`;
        }
        const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : wikiAssetUrl(href);
        return `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener"${titleAttr}>${text}</a>`;
      },
      image({ href, title, text }) {
        const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : wikiAssetUrl(href);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        return `<img src="${escapeAttr(url)}" alt="${escapeAttr(text)}"${titleAttr} style="max-width:100%" />`;
      },
    },
  });
  const html = marked.parse(markBannerEnglish(markdown), { async: false }) as string;
  const fragment = DOMPurify.sanitize(html, { ADD_ATTR: ["target"], RETURN_DOM_FRAGMENT: true });

  // Same "-1", "-2", ... de-duplication GitHub applies to repeated headings.
  const seen = new Map<string, number>();
  for (const heading of fragment.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const slug = githubSlug(heading.textContent ?? "");
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    heading.id = count === 0 ? slug : `${slug}-${count}`;
  }
  const container = document.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

/** The element a `data-wiki-anchor` refers to, searched only inside the
 * rendered page (never `document`, whose own ids could collide). */
export function findWikiAnchor(root: ParentNode, anchor: string): Element | null {
  return root.querySelector(`[id="${CSS.escape(anchor)}"]`);
}
