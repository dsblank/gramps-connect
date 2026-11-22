// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseDate } from "@gramps-connect/gramps-date";
import {
  ENHANCED_TEMPLATE,
  LEGACY_TEMPLATE,
  TemplateError,
  formatTemplateValue,
  locateTemplateExpression,
  selectErrorMessage,
  parseTemplate,
  renderTemplate,
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
