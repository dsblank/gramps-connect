import { describe, expect, it } from "vitest";
import {
  describeReportRun,
  parseReportOptions,
  toRequestOptions,
  type OptionField,
} from "../reportOptions";

// Slices of real GET /api/reports/<id> responses (Gramps 6.x against the
// dev fixture's example.gramps tree), trimmed to the options each case is
// about. Every spec shape the API can emit is represented across them.
const HELP = {
  // Booleans, numbers and enumerated lists (ancestor_report)
  incl_private: ["", "Whether to include private data", ["False", "True"]],
  maxgen: ["", "The number of generations to include in the report", "A number"],
  papermb: ["", "Bottom paper margin", "Size in cm"],
  inc_id: ["", "Whether to include Gramps IDs", ["0\tDo not include", "1\tInclude"]],
  pid: ["", "The center person for the report", ["I0044\tGarner, Lewis", "I2106\t, خديجة"]],
  papers: ["", "Paper size name.", ["Letter", "Legal", "A0"]],
  off: [
    "",
    "Output file format.",
    [
      "txt\tGenerates documents in plain text format (.txt).",
      "html\tGenerates documents in HTML format.",
      "pdf\tGenerates documents in PDF format (.pdf).",
    ],
  ],
  // Hidden: server-owned path/file options
  of: ["", "Output file name. MANDATORY", "/srv/reports"],
  css: ["", "CSS filename to use, html format only", "/srv/css"],
  style: ["", "Style name.", ["default"]],
  // Family IDs carry a trailing colon on the value (family_group)
  family_id: ["", "The center family for the filter", ["F0372:\tReed, Edward, Reed, Ellen"]],
  // Strings, colours and multi-line text (birthday_report / rel_graph)
  titletext: ["", "Title of report", "Any text"],
  colormales: ["", "The color to use to display men.", "The color to use to display men."],
  note: [
    "",
    "This text will be added to the graph.",
    "A list of text values. Each entry in the list represents one line of text.",
  ],
  // PersonListOption's spec is the empty string (familylines_graph)
  gidlist: ["", "People of interest", ""],
  // DestinationOption
  dest: ["", "Where to save", "A file system path"],
};

const DICT = {
  incl_private: true,
  maxgen: 10,
  papermb: 2.54,
  inc_id: 0,
  pid: "I0044",
  papers: "Letter",
  off: "print",
  of: "Ahnentafel Report demo",
  css: "",
  style: "default",
  family_id: "F0017",
  titletext: "Birthday and Anniversary Report",
  colormales: "#e0e0ff",
  note: [""],
  gidlist: "",
  dest: "/tmp",
};

function parse(keys: (keyof typeof DICT)[]): OptionField[] {
  const dict = Object.fromEntries(keys.map((key) => [key, DICT[key]]));
  const help = Object.fromEntries(keys.map((key) => [key, HELP[key]]));
  return parseReportOptions(dict, help);
}

function field(keys: (keyof typeof DICT)[], key: string): OptionField {
  const found = parse(keys).find((f) => f.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
}

describe("parseReportOptions", () => {
  it("maps each spec shape to a widget kind", () => {
    const kinds = Object.fromEntries(
      parse([
        "incl_private",
        "maxgen",
        "papermb",
        "inc_id",
        "titletext",
        "colormales",
        "note",
        "gidlist",
      ]).map((f) => [f.key, f.kind])
    );
    expect(kinds).toEqual({
      incl_private: "boolean",
      maxgen: "number",
      papermb: "number",
      inc_id: "select",
      titletext: "text",
      colormales: "color",
      note: "textlist",
      gidlist: "personlist",
    });
  });

  it("drops the server-owned options entirely", () => {
    const keys = parse(["of", "css", "style", "dest", "maxgen"]).map((f) => f.key);
    expect(keys).toEqual(["maxgen"]);
  });

  it("uses the help sentence as the label", () => {
    expect(field(["maxgen"], "maxgen").label).toBe(
      "The number of generations to include in the report"
    );
  });

  it("allows decimals only where the default is fractional", () => {
    // Gramps coerces incoming strings to the default's own type, and
    // int("0.2") throws -- so an int-defaulted option must stay integral.
    expect(field(["maxgen"], "maxgen").allowDecimal).toBe(false);
    expect(field(["papermb"], "papermb").allowDecimal).toBe(true);
  });

  it("splits enumerated items into value and description", () => {
    expect(field(["inc_id"], "inc_id").choices).toEqual([
      { value: "0", label: "Do not include", description: "Do not include" },
      { value: "1", label: "Include", description: "Include" },
    ]);
  });

  it("appends the Gramps ID to record labels so they can be searched by ID", () => {
    expect(field(["pid"], "pid").choices?.[0]).toEqual({
      value: "I0044",
      label: "Garner, Lewis (I0044)",
      description: "Garner, Lewis",
    });
  });

  it("strips the trailing colon family IDs carry", () => {
    // validate_options() compares against item.split("\t")[0].rstrip(":"),
    // so "F0372:" would be rejected as an unknown value.
    expect(field(["family_id"], "family_id").choices?.[0].value).toBe("F0372");
  });

  it("keeps a bare item (no description) as its own label", () => {
    expect(field(["papers"], "papers").choices?.[1]).toEqual({
      value: "Legal",
      label: "Legal",
      description: "",
    });
  });

  it("resolves the output format's unofferable 'print' default to PDF", () => {
    const off = field(["off"], "off");
    expect(off.serverDefault).toBe("print");
    expect(off.initial).toBe("pdf");
    expect(off.choices?.map((c) => c.label)).toEqual(["TXT", "HTML", "PDF"]);
  });

  it("falls back to the first format when none of the preferred ones exist", () => {
    // Graphviz reports offer neither pdf nor any other plain format.
    const off = parseReportOptions(
      { off: "print" },
      { off: ["", "Output file format.", ["gvpdf\tPDF (Graphviz)", "dot\tGraphviz File"]] }
    )[0];
    expect(off.initial).toBe("gvpdf");
  });

  it("orders format first, then the report's own options, then paper", () => {
    const groups = parse(["papers", "maxgen", "off", "papermb", "incl_private"]).map((f) => [
      f.key,
      f.group,
    ]);
    expect(groups).toEqual([
      ["off", "format"],
      ["maxgen", "main"],
      ["incl_private", "main"],
      ["papers", "paper"],
      ["papermb", "paper"],
    ]);
  });

  it("skips options the server gave no help for", () => {
    // get_report_profile() returns an empty options_help when building it
    // raised a HandleError (an empty tree, no people to enumerate).
    expect(parseReportOptions({ maxgen: 10 }, {})).toEqual([]);
  });

  it("serializes a multi-line default onto separate lines", () => {
    expect(
      parseReportOptions(
        { note: ["first", "second"] },
        { note: HELP.note }
      )[0].initial
    ).toBe("first\nsecond");
  });
});

describe("toRequestOptions", () => {
  it("sends only what differs from the server's own default", () => {
    const fields = parse(["maxgen", "incl_private", "titletext"]);
    const values = { maxgen: "4", incl_private: "True", titletext: "Birthday and Anniversary Report" };
    // maxgen changed; the other two still match their defaults.
    expect(toRequestOptions(fields, values)).toEqual({ maxgen: "4" });
  });

  it("always sends the output format, whose default is never offered", () => {
    const fields = parse(["off"]);
    expect(toRequestOptions(fields, {})).toEqual({ off: "pdf" });
  });

  it("writes booleans as the exact strings Gramps parses", () => {
    // _convert_str_to_match_type() compares against str(True)/str(False)
    // and silently yields False for anything else.
    const fields = parse(["incl_private"]);
    expect(toRequestOptions(fields, { incl_private: "False" })).toEqual({ incl_private: "False" });
  });

  it("writes multi-line text as quoted bracket notation", () => {
    // The list branch of _convert_str_to_match_type() parses nothing else,
    // and quoting each line is what lets a line contain a comma.
    const fields = parse(["note"]);
    expect(toRequestOptions(fields, { note: 'one, with comma\ntwo "quoted"' })).toEqual({
      note: '["one, with comma","two quoted"]',
    });
  });
});

describe("describeReportRun", () => {
  it("names the report's subject when an option identifies one", () => {
    const fields = parse(["pid", "inc_id"]);
    const desc = describeReportRun("Ahnentafel Report", fields, { pid: "I2106", inc_id: "1" });
    expect(desc).toMatch(/^Ahnentafel Report \(I2106\) — \d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to the plain label when nothing identifies a record", () => {
    const fields = parse(["inc_id"]);
    expect(describeReportRun("Database Summary Report", fields, {})).toMatch(
      /^Database Summary Report — \d{4}-\d{2}-\d{2}$/
    );
  });
});
