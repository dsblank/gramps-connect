import { describe, expect, it } from "vitest";
import { wikiPageUrl } from "../wikiDocsApi";

const BASE = "https://raw.githubusercontent.com/wiki/dsblank/gramps-connect";

describe("wikiPageUrl", () => {
  it("uses {page}.md for English and {page}.{lang}.md for translations", () => {
    expect(wikiPageUrl("Home")).toBe(`${BASE}/Home.md`);
    expect(wikiPageUrl("Home", "de")).toBe(`${BASE}/Home.de.md`);
  });

  it("stores translated sidebars as _Nav.{lang}.md, not _Sidebar.{lang}.md", () => {
    // GitHub would render a "_Sidebar.{lang}.md" as every page's sidebar.
    expect(wikiPageUrl("_Sidebar")).toBe(`${BASE}/_Sidebar.md`);
    expect(wikiPageUrl("_Sidebar", "zh_CN")).toBe(`${BASE}/_Nav.zh_CN.md`);
  });
});
