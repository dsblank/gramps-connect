// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findWikiAnchor, githubSlug, renderWikiMarkdown, splitWikiTarget } from "../wikiMarkdown";

function render(markdown: string): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = renderWikiMarkdown(markdown);
  return div;
}

describe("githubSlug", () => {
  it("matches the slugs the wiki's own links use", () => {
    expect(githubSlug("Browser storage: sessionStorage vs localStorage")).toBe(
      "browser-storage-sessionstorage-vs-localstorage",
    );
    expect(githubSlug("What's partially editable, by type")).toBe("whats-partially-editable-by-type");
    expect(githubSlug("Collections: any and len")).toBe("collections-any-and-len");
    expect(githubSlug("Add-ons run Python in the browser")).toBe("add-ons-run-python-in-the-browser");
  });

  it("keeps non-ASCII letters, as GitHub does", () => {
    expect(githubSlug("Caché local primero")).toBe("caché-local-primero");
  });
});

describe("renderWikiMarkdown", () => {
  it("gives headings GitHub-style ids, de-duplicating repeats", () => {
    const div = render("## Live sync\n\ntext\n\n## Notes\n\n## Notes\n");
    expect([...div.querySelectorAll("h2")].map((h) => h.id)).toEqual(["live-sync", "notes", "notes-1"]);
  });

  it("slugs inline code in headings by its text", () => {
    const div = render("## Collections: `any` and `len`\n");
    expect(div.querySelector("h2")?.id).toBe("collections-any-and-len");
  });

  it("keeps a translated heading's explicit English anchor", () => {
    const div = render('## Rapidez <a id="speed"></a>\n');
    expect(div.querySelector("h2")?.id).toBe("rapidez");
    expect(findWikiAnchor(div, "speed")).not.toBeNull();
    expect(findWikiAnchor(div, "rapidez")).not.toBeNull();
  });

  it("keeps the fragment of a link to another wiki page", () => {
    const link = render("[x](Architecture#live-sync)").querySelector("a");
    expect(link?.getAttribute("data-wiki-page")).toBe("Architecture");
    expect(link?.getAttribute("data-wiki-anchor")).toBe("live-sync");
  });

  it("carries a translated link's language explicitly", () => {
    const link = render("[x](Data-Model-and-Editing.es#merging-duplicate-records)").querySelector("a");
    expect(link?.getAttribute("data-wiki-page")).toBe("Data-Model-and-Editing");
    expect(link?.getAttribute("data-wiki-lang")).toBe("es");
    expect(link?.getAttribute("data-wiki-anchor")).toBe("merging-duplicate-records");
    expect(splitWikiTarget("Home.zh_CN")).toEqual({ page: "Home", lang: "zh_CN" });
    expect(splitWikiTarget("Under-the-Hood")).toEqual({ page: "Under-the-Hood", lang: null });
  });

  it("makes the banner's bare English link explicit, but not body links", () => {
    const div = render(
      "<!-- wiki-i18n:available-in:start -->\n🌐 *[English](Home) · [Deutsch](Home.de)*\n<!-- wiki-i18n:available-in:end -->\n\n[Overview](Overview)\n",
    );
    const [english, deutsch, body] = div.querySelectorAll("a");
    expect(english.getAttribute("data-wiki-page")).toBe("Home");
    expect(english.getAttribute("data-wiki-lang")).toBe("en");
    expect(deutsch.getAttribute("data-wiki-lang")).toBe("de");
    expect(body.getAttribute("data-wiki-page")).toBe("Overview");
    expect(body.hasAttribute("data-wiki-lang")).toBe(false);
  });

  it("treats a bare #fragment as a jump within the current page", () => {
    const link = render("[TLS](#tls)").querySelector("a");
    expect(link?.getAttribute("data-wiki-page")).toBe("");
    expect(link?.getAttribute("data-wiki-anchor")).toBe("tls");
    expect(link?.getAttribute("target")).toBeNull();
  });

  it("leaves links without a fragment and external links alone", () => {
    const div = render("[a](Overview) [b](https://example.com/x#y)");
    const [internal, external] = div.querySelectorAll("a");
    expect(internal.getAttribute("data-wiki-page")).toBe("Overview");
    expect(internal.hasAttribute("data-wiki-anchor")).toBe(false);
    expect(external.getAttribute("href")).toBe("https://example.com/x#y");
    expect(external.getAttribute("target")).toBe("_blank");
  });
});
