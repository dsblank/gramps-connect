// Translation of Gramps' abstract report-option schema into something a
// GUI can render. The schema is Gramps' own CLI-report introspection
// (gramps/cli/plug/__init__.py's CommandLineReport.init_report_options_help,
// as subclassed by gramps-web-api's ModifiedCommandLineReport), served
// verbatim by GET /api/reports/<id>. It's deliberately toolkit-neutral --
// desktop Gramps builds GTK widgets from the same option objects, gramps-web
// builds Material ones from this JSON -- so this module does the same job for
// Mantine, and stays free of React so it can be unit-tested on its own.
//
// Two values per option:
//   options_dict[key]        the default, in its *native* type
//   options_help[key]        [<unused>, <help text>, <spec>]
//
// `spec` is what discriminates the widget. Everything the API can emit:
//
//   ["False","True"]              BooleanOption
//   [...other...]                 EnumeratedListOption, items "value\tdesc"
//   "A number"                    NumberOption
//   "Size in cm"                  the paper-margin options
//   "Any text"                    StringOption
//   "A list of text values. ..."  TextOption (multi-line)
//   "A file system path"          DestinationOption
//   ""                            PersonListOption (space-separated GIDs)
//   <the help text, repeated>     any other Option subclass -- in practice
//                                 ColorOption, told apart by its #rrggbb
//                                 default
//
// Note that index 0 of options_help is always "" for menu options, so the
// help text at index 1 is the only label available; it's phrased as a
// sentence ("Whether to include private data") rather than a caption,
// which is what desktop Gramps shows in its tooltips. There is no shorter
// label to be had from this API.

export type OptionKind =
  | "boolean"
  | "select"
  | "number"
  | "text"
  | "textlist"
  | "color"
  | "personlist";

/** Which block of the dialog an option belongs in -- see groupOf(). */
export type OptionGroup = "format" | "main" | "paper";

export interface OptionChoice {
  value: string;
  /** Display text; also what a searchable Select matches against. */
  label: string;
  /** The spec item's description column, kept separately for the output-
   * format select, which shows it as secondary text under a short label. */
  description: string;
}

export interface OptionField {
  key: string;
  /** The help sentence -- the only label this API offers (see above). */
  label: string;
  kind: OptionKind;
  group: OptionGroup;
  /** Enumerated options only. */
  choices?: OptionChoice[];
  /** Numbers only: false when the default is an integer, since Gramps
   * coerces incoming strings to the default's type and int("0.2") throws
   * (see toRequestOptions). */
  allowDecimal?: boolean;
  /** What to show when the dialog opens, already serialized as a string
   * (textlist: newline-separated). Usually the server's default, but see
   * resolveInitial() for the output-format exception. */
  initial: string;
  /** The server's own default, serialized the same way as `initial`.
   * toRequestOptions() sends only what differs from this, so an untouched
   * option is simply omitted and Gramps applies its own default. */
  serverDefault: string;
}

// Same three gramps-web's GrampsjsReportOptions.js drops, for the same
// reasons: `of` is the output path, which the server sets itself and 422s
// on if a client sends it (reports.py's ReportFileResource); `css` and
// `style` name files in the server's own Gramps installation, which a
// browser client has no way to choose between meaningfully.
const HIDDEN_KEYS = new Set(["of", "css", "style"]);

// Options that come from the shared report/docgen machinery rather than
// the report itself -- every report has all of them, and they're almost
// never what someone opened the dialog to change. Collapsed out of the way.
const PAPER_KEYS = new Set([
  "papers",
  "papero",
  "papermb",
  "paperml",
  "papermr",
  "papermt",
  "name_format",
  "date_format",
  "place_format",
  "trans",
  "linechars",
]);

// Spec sentinels emitted verbatim by init_report_options_help.
const SPEC_NUMBER = "A number";
const SPEC_SIZE_CM = "Size in cm";
const SPEC_TEXT = "Any text";
const SPEC_TEXTLIST = "A list of text values";
const SPEC_PATH = "A file system path";

const COLOR_RE = /^#[0-9a-f]{6}$/i;

// A Gramps ID as it appears as an enumerated value -- the ID prefix is
// user-configurable, so this matches shape rather than the stock letters.
// Used to decide whether a choice's label needs its ID appended (a person
// list shows only names otherwise, and IDs are what someone pastes) and,
// in describeReportRun(), which option identifies the report's subject.
const GRAMPS_ID_RE = /^[A-Za-z]{1,4}\d+$/;

// The default for `off` is "print" (desktop Gramps' print-preview target),
// which is never one of the offered formats -- so a first choice has to be
// made here. Preference order, most useful first; a report offering none
// of these (only Graphviz's raw .dot, say) falls back to its first item.
const FORMAT_PREFERENCE = ["pdf", "gvpdf", "gspdf", "png", "svg", "odt", "html", "txt"];

/** One entry of an enumerated spec: "value\tdescription", or a bare value
 * with no description at all (paper sizes). Family IDs additionally carry
 * a trailing colon on the value ("F0372:\tReed, Edward, Reed, Ellen") --
 * stripped here to match both gramps-web's reportSelectItemValue() and the
 * server's own validate_options(), which compares against
 * `item.split("\t")[0].rstrip(":")`. */
function parseChoice(item: string): OptionChoice {
  const parts = String(item).split(/\t+/).map((part) => part.trim());
  const value = parts[0].replace(/:$/, "");
  const description = parts.length > 1 ? parts.slice(1).join(" ").trim() : "";
  // Object-valued choices (people, families, notes, media) describe
  // themselves by name only, so the ID goes back on the label -- both to
  // disambiguate identically-named people and so the searchable Select
  // can be driven by ID.
  const label = description
    ? GRAMPS_ID_RE.test(value)
      ? `${description} (${value})`
      : description
    : value;
  return { value, label, description };
}

function isBooleanSpec(spec: string[]): boolean {
  return spec.length === 2 && [...spec].sort().join("|") === "False|True";
}

function groupOf(key: string): OptionGroup {
  if (key === "off") return "format";
  return PAPER_KEYS.has(key) ? "paper" : "main";
}

/** Serializes a native default the way the matching widget holds it, and
 * the wire carries it. TextOption defaults arrive as arrays of lines, and
 * BooleanOption defaults as real JSON booleans -- which have to become
 * Python's "True"/"False" rather than JavaScript's "true"/"false", since
 * that spelling is both what the boolean spec enumerates and the only one
 * Gramps parses back (see serializeValue). */
function serializeDefault(value: unknown): string {
  if (Array.isArray(value)) return value.join("\n");
  if (typeof value === "boolean") return value ? "True" : "False";
  return value === null || value === undefined ? "" : String(value);
}

function resolveInitial(key: string, serverDefault: string, choices?: OptionChoice[]): string {
  if (!choices || choices.length === 0) return serverDefault;
  if (choices.some((choice) => choice.value === serverDefault)) return serverDefault;
  // Not an offered value. For `off` that's the norm ("print", see
  // FORMAT_PREFERENCE); for anything else it means the default names a
  // record that was filtered out of the list, and the first item is as
  // good a fallback as any.
  if (key === "off") {
    const preferred = FORMAT_PREFERENCE.find((fmt) => choices.some((c) => c.value === fmt));
    if (preferred) return preferred;
  }
  return choices[0].value;
}

function kindOf(spec: unknown, serverDefault: string): OptionKind | null {
  if (Array.isArray(spec)) {
    return isBooleanSpec(spec as string[]) ? "boolean" : "select";
  }
  const text = typeof spec === "string" ? spec : "";
  if (text.includes(SPEC_PATH)) return null; // DestinationOption -- server-side path, not ours to set
  if (text.includes(SPEC_NUMBER) || text.includes(SPEC_SIZE_CM)) return "number";
  if (text.includes(SPEC_TEXTLIST)) return "textlist";
  if (text.includes(SPEC_TEXT)) return "text";
  if (text === "") return "personlist"; // PersonListOption's spec is "" (report.py)
  // Anything left is an Option subclass the API had no specific branch
  // for, so it echoed the help text back. ColorOption is the one that
  // occurs in practice (the Graphviz reports' colour pickers) and its
  // default is the giveaway.
  return COLOR_RE.test(serverDefault) ? "color" : "text";
}

/** Builds the renderable field list for one report, in the order the
 * dialog should show them: output format first, then the report's own
 * options, then the shared paper/formatting block. Options within a group
 * keep the API's own (alphabetical) order. */
export function parseReportOptions(
  optionsDict: Record<string, unknown>,
  optionsHelp: Record<string, unknown[]>
): OptionField[] {
  const fields: OptionField[] = [];
  for (const key of Object.keys(optionsDict)) {
    if (HIDDEN_KEYS.has(key)) continue;
    const help = optionsHelp?.[key];
    // An option with no help entry can't be rendered (no label, no spec).
    // Happens on an empty database, where get_report_profile() catches a
    // HandleError and returns no options_help at all.
    if (!Array.isArray(help) || help.length < 3) continue;

    const serverDefault = serializeDefault(optionsDict[key]);
    const kind = kindOf(help[2], serverDefault);
    if (kind === null) continue;

    let choices = kind === "select" ? (help[2] as string[]).map(parseChoice) : undefined;
    // The output format's descriptions are whole sentences ("Generates
    // documents in PDF format (.pdf).") -- fine as secondary text in the
    // dropdown, far too long as the label of a closed select. The value
    // itself is the recognisable name of the format.
    if (key === "off" && choices) {
      choices = choices.map((choice) => ({ ...choice, label: choice.value.toUpperCase() }));
    }

    fields.push({
      key,
      label: String(help[1] ?? key),
      kind,
      group: groupOf(key),
      choices,
      allowDecimal: kind === "number" ? !Number.isInteger(optionsDict[key]) : undefined,
      initial: resolveInitial(key, serverDefault, choices),
      serverDefault,
    });
  }

  const order: Record<OptionGroup, number> = { format: 0, main: 1, paper: 2 };
  return fields.sort((a, b) => order[a.group] - order[b.group]);
}

/** Serializes one field's current value for the API. Everything goes as a
 * string -- validate_options() (gramps_webapi/api/report.py) rejects any
 * non-string outright -- and Gramps then coerces each string back to the
 * type of its own default in _convert_str_to_match_type()
 * (gramps/cli/plug/__init__.py:99). Two of those coercions are picky:
 *
 *  - bool accepts only the exact strings "True"/"False", anything else
 *    logs and becomes False.
 *  - list accepts only bracket notation, `[a,b,c]`, splitting on unquoted
 *    commas -- so each line is quoted here, which also lets a line contain
 *    a comma. The parser has no escape syntax, so a literal double quote
 *    can't survive and is dropped rather than left to truncate the line.
 */
function serializeValue(field: OptionField, value: string): string {
  if (field.kind === "boolean") return value === "True" ? "True" : "False";
  if (field.kind === "textlist") {
    const lines = value.split("\n").map((line) => line.replace(/"/g, "").trim());
    return `[${lines.map((line) => `"${line}"`).join(",")}]`;
  }
  return value;
}

/** Builds the `options` payload for POST /api/reports/<id>/file.
 *
 * Only options whose value differs from the server's own default are
 * sent. An untouched option is then filled in by Gramps itself, which is
 * both smaller on the wire and strictly safer than round-tripping a value
 * through this module's serialization for no reason. It needs no special
 * case to still send the two that always differ: `off`, whose default
 * "print" is never an offered format, and any option pre-filled from the
 * app's current selection. */
export function toRequestOptions(
  fields: OptionField[],
  values: Record<string, string>
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key] ?? field.initial;
    if (value === field.serverDefault) continue;
    options[field.key] = serializeValue(field, value);
  }
  return options;
}

/** The `desc` for the Media object this report will become -- passed to
 * trackJob() as its optionsSummary, since the dispatching tab is the only
 * place the chosen options exist (they're never persisted server-side; see
 * jobsPoll.ts). Same "<label> — <date>" shape describeGenericJob() builds
 * for a job whose tab is gone, with the report's subject added when one of
 * the chosen options names a record, so a list of six Ahnentafel runs in
 * the Output view can be told apart. */
export function describeReportRun(
  reportName: string,
  fields: OptionField[],
  values: Record<string, string>
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const subject = fields
    .filter((field) => field.kind === "select")
    .map((field) => values[field.key] ?? field.initial)
    .find((value) => GRAMPS_ID_RE.test(value));
  return subject ? `${reportName} (${subject}) — ${stamp}` : `${reportName} — ${stamp}`;
}
