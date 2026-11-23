// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseDate } from "@gramps-connect/gramps-date";
import {
  ENHANCED_TEMPLATE,
  LEGACY_TEMPLATE,
  STARTER_TEMPLATES,
  TemplateError,
  formatTemplateValue,
  locateTemplateExpression,
  selectErrorMessage,
  linesToHtml,
  linesToText,
  parseTemplate,
  renderTemplate,
  renderTemplateRuns,
  templateExpressions,
} from "../citationTemplate";
import { formatCitationText, formatSourceText } from "../citationFormat";
import { formatDisplayDate } from "../placeIndex";

const render = (template: string, values: Record<string, string>) =>
  renderTemplate(parseTemplate(template), new Map(Object.entries(values)));

describe("parseTemplate", () => {
  it("splits text, expressions and nested groups", () => {
    expect(parseTemplate('`a`[, "`b.c`"[ (`d`)]]')).toEqual([
      { kind: "expr", expr: "a", column: 2 },
      {
        kind: "group",
        column: 4,
        children: [
          { kind: "text", text: ', "' },
          { kind: "expr", expr: "b.c", column: 9 },
          { kind: "text", text: '"' },
          {
            kind: "group",
            column: 14,
            children: [{ kind: "text", text: " (" }, { kind: "expr", expr: "d", column: 18 }, { kind: "text", text: ")" }],
          },
        ],
      },
    ]);
  });

  it("keeps brackets and quotes inside an expression as GOQL", () => {
    expect(templateExpressions(parseTemplate("`repositories[0].name` `attribute_list['Film'].value`"))).toEqual([
      "repositories[0].name",
      "attribute_list['Film'].value",
    ]);
  });

  it("makes an escaped character plain text", () => {
    expect(render("\\[`a`\\] \\` \\\\", { a: "x" })).toBe("[x] ` \\");
  });

  it.each([
    ["`a", "This ` is never closed", 1],
    ["x ``", "Empty", 3],
    ["[`a`", "This [ is never closed", 1],
    ["`a`]", "This ] has no [ before it", 4],
    ["a\\", "nothing to make plain", 2],
  ])("rejects %j", (template, message, column) => {
    try {
      parseTemplate(template);
      expect.fail("parsed");
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateError);
      expect((e as TemplateError).message).toContain(message);
      expect((e as TemplateError).column).toBe(column);
    }
  });
});

describe("renderTemplate", () => {
  it("drops a group whose expression is empty", () => {
    expect(render("`a`[, `b`][, `c`]", { a: "A", c: "C" })).toBe("A, C");
  });

  it("leaves out a group's leading separator at the start of the line", () => {
    expect(render("`a`[, `b`][ - `c`]", { b: "B", c: "C" })).toBe("B - C");
    expect(render("[`a`][ - `c`]", { c: "C" })).toBe("C");
  });

  it("keeps an opening bracket or quote at the start of the line", () => {
    expect(render('[, (`a`)][, "`b`"]', { a: "A" })).toBe("(A)");
    expect(render('[, (`a`)][, "`b`"]', { b: "B" })).toBe('"B"');
  });

  it("drops an outer group only for its own expressions, not a nested group's", () => {
    expect(render("[`a`[ (`b`)]]", { a: "A" })).toBe("A");
    expect(render("[`a`[ (`b`)]]", { b: "B" })).toBe("");
  });

  it("writes an empty top-level expression as nothing", () => {
    expect(render("`a` and `b`", { b: "B" })).toBe("and B");
  });
});

describe("formatTemplateValue", () => {
  it("formats by shape", () => {
    const date = parseDate("1890-05-01", { locale: "en" });
    expect(formatTemplateValue("date", date)).toBe(formatDisplayDate(date));
    expect(formatTemplateValue("x", { _class: "SrcAttributeType", string: "Film", value: 0 })).toBe("Film");
    expect(formatTemplateValue("x", { _class: "AttributeType", string: "", value: 7 })).toBe("Nickname");
    expect(formatTemplateValue("reporef_list[0].media_type", { _class: "SourceMediaType", string: "", value: 6 })).toBe("Film");
    expect(formatTemplateValue("x", ["a", null, "b"])).toBe("a, b");
    expect(formatTemplateValue("x", 12)).toBe("12");
    expect(formatTemplateValue("x", null)).toBe("");
    expect(formatTemplateValue("x", { _class: "Citation" })).toBe("");
  });

  it("shows a confidence by name, and nothing for Normal", () => {
    expect(formatTemplateValue("confidence", 4)).toBe("Very High");
    expect(formatTemplateValue("source.confidence", 0)).toBe("Very Low");
    expect(formatTemplateValue("confidence", 2)).toBe("");
  });
});

describe("built-in templates match citationFormat.ts", () => {
  const date = parseDate("1890-05-01", { locale: "en" });
  const sources = [
    { author: "Smith, John", title: "Parish Registers", pubinfo: "London, 1890", abbrev: "PR" },
    { title: "Census" },
    { author: "A", abbrev: "B" },
    {},
  ];
  const repos = [null, { name: "Archive", callNumber: "A1" }, { name: "Archive" }];
  const citations = [
    { page: "p. 12", date, confidence: 2 },
    { date, confidence: 4 },
    { page: "p. 12", confidence: 0 },
    { confidence: 2 },
  ];

  function sourceValues(s: Partial<Record<string, string>>, repo: { name: string; callNumber?: string } | null) {
    return new Map(
      Object.entries({
        author: s.author ?? "",
        title: s.title ?? "",
        pubinfo: s.pubinfo ?? "",
        abbrev: s.abbrev ?? "",
        "repositories[0].name": repo?.name ?? "",
        "reporef_list[0].call_number": repo?.callNumber ?? "",
      }),
    );
  }

  it.each(sources)("Legacy source %j", (s) => {
    expect(renderTemplate(parseTemplate(LEGACY_TEMPLATE.source), sourceValues(s, null))).toBe(formatSourceText("legacy", s));
  });

  it.each(sources.flatMap((s) => repos.map((r) => [s, r] as const)))("Enhanced source %j %j", (s, repo) => {
    expect(renderTemplate(parseTemplate(ENHANCED_TEMPLATE.source), sourceValues(s, repo))).toBe(
      formatSourceText("enhanced", s, repo),
    );
  });

  it.each(citations)("citation line %#", (c) => {
    const nodes = parseTemplate(LEGACY_TEMPLATE.citation);
    const values = new Map(
      templateExpressions(nodes).map((e) => [e, formatTemplateValue(e, (c as Record<string, unknown>)[e])]),
    );
    expect(renderTemplate(nodes, values)).toBe(formatCitationText(c));
  });
});

describe("locateTemplateExpression", () => {
  it("finds the expression around the cursor", () => {
    const value = "`author`[, `source.ti";
    expect(locateTemplateExpression(value, value.length)).toEqual({ source: "source.ti", offset: 12 });
    expect(locateTemplateExpression("`author`, x", 3)).toEqual({ source: "author", offset: 1 });
  });

  it("is null outside backticks, and an escaped backtick doesn't open one", () => {
    expect(locateTemplateExpression("`a`, x", 5)).toBeNull();
    expect(locateTemplateExpression("\\` x", 4)).toBeNull();
  });
});

describe("selectErrorMessage", () => {
  it("names the template's expression for each rejected select entry", async () => {
    const body = {
      error: {
        code: 422,
        message: "Invalid 'select'",
        messages: {
          json: {
            select: {
              "2": ["invalid select entry 'titel as v1': unknown field 'titel' on Source -- known fields: title"],
            },
          },
        },
      },
    };
    const res = new Response(JSON.stringify(body), { status: 422 });
    expect(await selectErrorMessage(res, ["author", "titel"])).toBe(
      "`titel`: unknown field 'titel' on Source -- known fields: title",
    );
  });

  it("is null for other replies", async () => {
    expect(await selectErrorMessage(new Response("oops", { status: 500 }), ["a"])).toBeNull();
    expect(await selectErrorMessage(new Response(JSON.stringify({ error: { message: "x" } })), ["a"])).toBeNull();
  });
});

describe("italic and bold", () => {
  const runs = (template: string, values: Record<string, string>) =>
    renderTemplateRuns(parseTemplate(template), new Map(Object.entries(values)));

  it("styles the template's text and the values inside the markers", () => {
    expect(runs("[`author`, ]*`title`*[ (`pubinfo`)]", { author: "Jane Doe", title: "Leeds", pubinfo: "London, 1890" })).toEqual([
      { text: "Jane Doe, " },
      { text: "Leeds", italic: true },
      { text: " (London, 1890)" },
    ]);
    expect(runs("**`a`** and ***`b`***", { a: "A", b: "B" })).toEqual([
      { text: "A", bold: true },
      { text: " and " },
      { text: "B", italic: true, bold: true },
    ]);
  });

  it("never reads markers in a value, and \\* is a plain asterisk", () => {
    expect(runs("`a` \\*", { a: "*not italic*" })).toEqual([{ text: "*not italic* *" }]);
  });

  it("keeps a GOQL * inside backticks", () => {
    expect(templateExpressions(parseTemplate("*`a * 2`*"))).toEqual(["a * 2"]);
  });

  it("drops a whole styled part, and strips separators across styled runs", () => {
    expect(runs('[`a`][, *"`b`"*]', { b: "B" })).toEqual([{ text: '"B"', italic: true }]);
    expect(runs("[*`a`*][, `b`]", { b: "B" })).toEqual([{ text: "B" }]);
  });

  it.each([
    ["*`a`", "This * is never closed", 1],
    ["x **`a`", "This ** is never closed", 3],
    ["[*`a`]*", "This * is never closed", 2],
  ])("rejects %j", (template, message, column) => {
    try {
      parseTemplate(template);
      expect.fail("parsed");
    } catch (e) {
      expect((e as TemplateError).message).toContain(message);
      expect((e as TemplateError).column).toBe(column);
    }
  });

  it("copies as HTML and plain text", () => {
    const lines = [[{ text: "A & " }, { text: "<B>", italic: true }], [{ text: "p. 3", bold: true }]];
    expect(linesToHtml(lines)).toBe("A &amp; <i>&lt;B&gt;</i><br><b>p. 3</b>");
    expect(linesToText(lines)).toBe("A & <B>\np. 3");
  });
});

describe("starter templates", () => {
  const starter = (name: string) => STARTER_TEMPLATES.find((st) => st.name === name)!;
  const line = (template: string, values: Record<string, string>) =>
    renderTemplate(parseTemplate(template), new Map(Object.entries(values)));

  it("all parse", () => {
    for (const st of STARTER_TEMPLATES) {
      expect(() => parseTemplate(st.source), st.name).not.toThrow();
      expect(() => parseTemplate(st.citation), st.name).not.toThrow();
    }
  });

  it("write an online record, with and without its optional parts", () => {
    const { source, citation } = starter("Online record");
    expect(
      line(source, {
        title: "England and Wales Census, 1881",
        "attribute_list['Medium'].value": "database with images",
        "repositories[0].name": "FamilySearch",
      }),
    ).toBe('"England and Wales Census, 1881," database with images, FamilySearch');
    expect(
      line(citation, {
        "attribute_list['Item'].value": "John Smith household, Leeds, Yorkshire",
        "attribute_list['URL'].value": "https://example.org/r/1",
        "attribute_list['Accessed'].value": "22 November 2026",
        "source.attribute_list['Original'].value": "The National Archives, Kew",
        page: "RG11/4321, folio 56, page 7",
      }),
    ).toBe(
      "John Smith household, Leeds, Yorkshire (https://example.org/r/1 : accessed 22 November 2026); citing The National Archives, Kew, RG11/4321, folio 56, page 7",
    );
    expect(line(citation, { "attribute_list['Item'].value": "Mary Brown, Leeds, 1890 Q2", page: "vol. 9b, p. 512" })).toBe(
      "Mary Brown, Leeds, 1890 Q2, vol. 9b, p. 512",
    );
  });

  it("write an archive record, a book, a newspaper and a gravestone", () => {
    expect(
      line(starter("Archive record").citation, {
        "attribute_list['Item'].value": "John Smith baptism",
        page: "p. 12, no. 96",
        date: "3 May 1820",
        "attribute_list['Film'].value": "1,234,567",
      }),
    ).toBe("John Smith baptism, p. 12, no. 96 (3 May 1820); microfilm 1,234,567");
    expect(line(starter("Archive record").citation, { page: "RG11/4321, folio 56, page 7" })).toBe("RG11/4321, folio 56, page 7");
    expect(
      renderTemplateRuns(parseTemplate(starter("Book").source), new Map(Object.entries({ author: "Jane Doe", title: "A History of Leeds", pubinfo: "London: Smith & Co., 1890" }))),
    ).toEqual([{ text: "Jane Doe, " }, { text: "A History of Leeds", italic: true }, { text: " (London: Smith & Co., 1890)" }]);
    expect(
      line(starter("Newspaper").citation, { "attribute_list['Item'].value": "Local News", date: "4 May 1890", page: "p. 3, col. 2" }),
    ).toBe('"Local News," 4 May 1890, p. 3, col. 2');
    expect(
      line(starter("Gravestone").citation, {
        "attribute_list['Item'].value": "John Smith gravestone",
        page: "section B, grave 412",
        date: "12 June 2019",
      }),
    ).toBe("John Smith gravestone, section B, grave 412, photographed 12 June 2019");
  });
});

describe("cleaning up after empty fields", () => {
  const line = (template: string, values: Record<string, string>) =>
    renderTemplate(parseTemplate(template), new Map(Object.entries(values)));

  it("fixes the starters' rough edges", () => {
    const online = STARTER_TEMPLATES.find((st) => st.name === "Online record")!;
    expect(line(online.source, { title: "England and Wales Census, 1881" })).toBe('"England and Wales Census, 1881"');
    const newspaper = STARTER_TEMPLATES.find((st) => st.name === "Newspaper")!;
    expect(line(newspaper.citation, { "attribute_list['Item'].value": "Local News", page: "p. 3" })).toBe(
      '"Local News," p. 3',
    );
  });

  it("drops a separator next to a bracket, and empty brackets and quotes", () => {
    expect(line("`a` (`b`, `c`)", { a: "A", b: "Leeds" })).toBe("A (Leeds)");
    expect(line("`a` (`b`, `c`)", { a: "A", c: "p. 3" })).toBe("A (p. 3)");
    expect(line('`a` (`b`) "`c`" [`d`]', { a: "A" })).toBe("A");
  });

  it("collapses doubled separators and spaces", () => {
    expect(line("`a`, `b`, `c`", { a: "A", c: "C" })).toBe("A, C");
    expect(line("`a`; `b`, `c`", { a: "A", c: "C" })).toBe("A; C");
    expect(line("`a`,  `b`", { a: "A", b: "B" })).toBe("A, B");
  });

  it("never changes a field's own text", () => {
    expect(line("`a`", { a: "Smith, " })).toBe("Smith,");
    expect(line("`a`", { a: "one , , two ()" })).toBe("one , , two ()");
    expect(line("`a`, `b`", { a: "London,", b: "1890" })).toBe("London, 1890");
  });

  it("keeps a space a style wants before a separator", () => {
    expect(line("(`u` : accessed `d`)", { u: "https://x", d: "1 May 2020" })).toBe("(https://x : accessed 1 May 2020)");
  });

  it("keeps the styling", () => {
    expect(renderTemplateRuns(parseTemplate("*`a`*, `b`"), new Map([["a", "Title"]]))).toEqual([{ text: "Title", italic: true }]);
  });
});
