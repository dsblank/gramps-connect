// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  fold,
  highlightWikiMatches,
  plainText,
  queryTerms,
  searchWikiSections,
  snippetFor,
  splitWikiSections,
  wikiPagesFromNav,
} from "../wikiSearch";

function search(markdown: string, query: string, lang = "en", page = "Page") {
  return searchWikiSections(splitWikiSections(markdown, page, lang), query, lang);
}

function highlighted(parts: { text: string; match: boolean }[]): string[] {
  return parts.filter((p) => p.match).map((p) => p.text);
}

describe("fold", () => {
  it("drops case and accents", () => {
    expect(fold("Einträge")).toBe("eintrage");
    expect(fold("Écrire des Gramplets")).toBe("ecrire des gramplets");
  });
});

describe("plainText", () => {
  it("keeps link text and drops markup", () => {
    expect(plainText("See [Maps](Maps#overlays) and **bold** `code`.")).toBe("See Maps and bold code .");
    expect(plainText("Set `GRAMPS_WEB_API_KEY`.")).toBe("Set GRAMPS_WEB_API_KEY .");
    expect(plainText("- one\n- two\n\n![pic](images/x.png)")).toBe("one two");
  });
});

describe("splitWikiSections", () => {
  const page = [
    "# Maps",
    "",
    "Intro text.",
    "",
    "## Map overlays",
    "",
    "Overlay text.",
    "",
    "```sh",
    "# not a heading",
    "```",
    "",
    "### Notes",
    "",
    "One.",
    "",
    "### Notes",
    "",
    "Two.",
  ].join("\n");

  it("splits at headings, with the page title and GitHub-style anchors", () => {
    const sections = splitWikiSections(page, "Maps", "en");
    expect(sections.map((s) => [s.heading, s.anchor])).toEqual([
      [null, null],
      ["Map overlays", "map-overlays"],
      ["Notes", "notes"],
      ["Notes", "notes-1"],
    ]);
    expect(sections.every((s) => s.pageTitle === "Maps")).toBe(true);
    expect(sections[1].text).toContain("not a heading");
  });

  it("uses a translated heading's explicit English anchor", () => {
    const sections = splitWikiSections('# Karten\n\n## Kartenüberlagerungen <a id="map-overlays"></a>\n\nText.', "Maps", "de");
    expect(sections[0].heading).toBe("Kartenüberlagerungen");
    expect(sections[0].anchor).toBe("map-overlays");
  });

  it("leaves out the language banner and translation marker", () => {
    const md = [
      "<!-- translated-from-sha: abc123 -->",
      "<!-- wiki-i18n:available-in:start -->",
      "🌐 *[English](Maps)*",
      "<!-- wiki-i18n:available-in:end -->",
      "",
      "# Karten",
      "",
      "Text.",
    ].join("\n");
    const [intro] = splitWikiSections(md, "Maps", "de");
    expect(intro.text).not.toContain("translated");
  });
});

describe("wikiPagesFromNav", () => {
  it("lists each linked page once, without language suffixes or external links", () => {
    const nav = "**[Startseite](Home)**\n- [Karten](Maps)\n- [Karten](Maps.de#x)\n[Repo](https://github.com/x/y)";
    expect(wikiPagesFromNav(nav)).toEqual(["Home", "Maps"]);
  });
});

describe("searchWikiSections", () => {
  const md = [
    "# Page",
    "",
    "## Merging duplicate records",
    "",
    "Select two records and choose Merge.",
    "",
    "## Charts",
    "",
    "Charts can be merged into a PDF. Records are drawn as boxes.",
  ].join("\n");

  it("matches word prefixes and ranks heading matches first", () => {
    const results = search(md, "merg");
    expect(results.map((r) => r.section.heading)).toEqual(["Merging duplicate records", "Charts"]);
  });

  it("requires every term", () => {
    expect(search(md, "merge pdf").map((r) => r.section.heading)).toEqual(["Charts"]);
    expect(search(md, "merge nothing")).toEqual([]);
  });

  it("doesn't match in the middle of a word", () => {
    expect(search(md, "erg")).toEqual([]);
  });

  it("folds accents on both sides", () => {
    const de = "# Seite\n\n## Einträge\n\nÄltere Einträge löschen.";
    expect(search(de, "eintrage", "de")).toHaveLength(1);
    expect(search(de, "ÄLTERE", "de")).toHaveLength(1);
  });

  it("matches Chinese phrases as substrings", () => {
    const zh = "# 地图\n\n## 地图叠加层\n\n每个叠加层至少属于一个地点。\n\n## 历史地图\n\n切换地图外观。";
    expect(search(zh, "叠加层", "zh_CN").map((r) => r.section.heading)).toEqual(["地图叠加层"]);
    expect(search(zh, "地点", "zh_CN")).toHaveLength(1);
  });

  it("matches Korean, which folding decomposes", () => {
    const ko = "# 지도\n\n## 지도 겹침\n\n장소에 속합니다.";
    const [result] = search(ko, "겹침", "ko");
    expect(result.section.heading).toBe("지도 겹침");
  });
});

describe("snippetFor", () => {
  it("highlights matches as written in the text", () => {
    const [section] = splitWikiSections("# P\n\n## H\n\nAlte Einträge und neue Einträge.", "P", "de");
    const parts = snippetFor(section, queryTerms("eintrage", "de"));
    expect(highlighted(parts)).toEqual(["Einträge", "Einträge"]);
    expect(parts.map((p) => p.text).join("")).toBe("Alte Einträge und neue Einträge.");
  });

  it("highlights a Chinese phrase that spans several segments", () => {
    const [section] = splitWikiSections("# 地图\n\n## H\n\n每个叠加层至少属于一个地点，也可以附加已有的叠加层。", "Maps", "zh_CN");
    expect(highlighted(snippetFor(section, queryTerms("叠加层", "zh_CN")))).toEqual(["叠加层", "叠加层"]);
  });

  it("trims long text to a window around the first match", () => {
    const long = `${"word ".repeat(100)}target ${"word ".repeat(100)}`;
    const [section] = splitWikiSections(`# P\n\n## H\n\n${long}`, "P", "en");
    const parts = snippetFor(section, queryTerms("target", "en"));
    const text = parts.map((p) => p.text).join("");
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(220);
    expect(highlighted(parts)).toEqual(["target"]);
  });
});

describe("highlightWikiMatches", () => {
  function page(html: string): HTMLDivElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  }
  const marks = (div: HTMLElement) => [...div.querySelectorAll("mark")].map((m) => m.textContent);

  it("marks matches as written, inside links too, leaving the markup alone", () => {
    const div = page('<h2>Einträge</h2><p>Alte <a href="#">Einträge</a> löschen.</p>');
    highlightWikiMatches(div, "eintrage", "de");
    expect(marks(div)).toEqual(["Einträge", "Einträge"]);
    expect(div.querySelector("a mark")).not.toBeNull();
    expect(div.textContent).toBe("EinträgeAlte Einträge löschen.");
  });

  it("replaces earlier highlighting, and an empty query removes it", () => {
    const div = page("<p>Merge charts, then export charts.</p>");
    highlightWikiMatches(div, "merge", "en");
    highlightWikiMatches(div, "chart", "en");
    expect(marks(div)).toEqual(["charts", "charts"]);
    highlightWikiMatches(div, "", "en");
    expect(marks(div)).toEqual([]);
    expect(div.innerHTML).toBe("<p>Merge charts, then export charts.</p>");
  });

  it("marks a whole Chinese phrase", () => {
    const div = page("<p>每个叠加层至少属于一个地点。</p>");
    highlightWikiMatches(div, "叠加层", "zh_CN");
    expect(marks(div).join("")).toBe("叠加层");
  });
});
