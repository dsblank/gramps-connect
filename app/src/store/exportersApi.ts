// Thin wrappers around gramps-web-api's existing exporters endpoints
// (resources/exporters.py) -- the *front* of the export pipeline, whose
// back half has been in place since the reports work: jobsPoll.ts already
// maps the `export_db` task to a JobKind, jobsPromote.ts already turns its
// result file into an "export"-tagged Media object, and the Output view
// already lists and downloads the result. Nothing new server-side; same
// shape as reportsApi.ts's wrappers around the report endpoints.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

export interface ExporterSummary {
  /** Plugin display name, still carrying its GTK mnemonic marker
   * ("GE_DCOM", "_vCard") -- run it through jobsPromote.ts's
   * stripMnemonic() before showing it. */
  name: string;
  description: string;
  /** Default file extension -- also this exporter's id in every URL
   * below, since the API keys exporters by extension rather than by
   * module. */
  extension: string;
  module: string;
}

/** GET /api/exporters/ -- the installed exporter plugins, minus any the
 * server disables (DISABLED_EXPORTERS in gramps_webapi.const, currently
 * `gpkg`). Eight formats on a stock install. */
export async function listExporters(token: string): Promise<ExporterSummary[]> {
  const res = await fetch(`${API_BASE}/api/exporters/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export type RunExportResult =
  | { kind: "task"; taskId: string }
  | { kind: "done"; url: string };

/** POST /api/exporters/<extension>/file?<options>.
 *
 * The same two possible successes runReport() has to handle: 202 with a
 * task to poll when a Celery broker is configured, or 201 with the
 * finished file's own `url` when run_task() fell back to running it
 * inline. Callers hand the first to trackJob() and the second straight to
 * promoteJob() -- both end at the same tagged Media object.
 *
 * Note the options go in the query string, not a JSON body: unlike the
 * reports endpoint (one `options` parameter holding a JSON blob, because
 * each report's option set is its own), the exporter options are a fixed,
 * flat schema the API declares as query args (ExporterFileQueryArgs). */
export async function runExport(
  token: string,
  extension: string,
  params: Record<string, string>
): Promise<RunExportResult> {
  const query = new URLSearchParams(params);
  const res = await fetch(
    `${API_BASE}/api/exporters/${encodeURIComponent(extension)}/file?${query}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = await res.json();
  if (res.status === 202) return { kind: "task", taskId: body.task.id };
  return { kind: "done", url: body.url };
}

/** How living people are handled, as the API's `living` enum (mapped
 * server-side onto LivingProxyDb's modes in export.py's LIVING_FILTERS).
 * Labels follow desktop Gramps' own export assistant where it offers the
 * same choice (gui/plug/export/_exportoptions.py); FullNameOnly has no
 * desktop equivalent there, so its label is descriptive. */
export const LIVING_MODES: { value: string; label: string }[] = [
  { value: "IncludeAll", label: "Include all selected people" },
  { value: "FullNameOnly", label: "Keep living people's names, drop their other data" },
  { value: "LastNameOnly", label: "Replace given names of living people" },
  { value: "ReplaceCompleteName", label: "Replace complete name of living people" },
  { value: "ExcludeAll", label: "Do not include living people" },
];

export const DEFAULT_LIVING = "IncludeAll";

// The API's own default (ExporterFileQueryArgs.years_after_death), and the
// value the field is seeded with whenever a living-people restriction is
// switched on.
export const DEFAULT_YEARS_AFTER_DEATH = 0;

/** One boolean export option, as a query arg of ExporterFileQueryArgs.
 * `key` is the arg name sent verbatim. */
export interface ExportToggle {
  key: string;
  label: string;
  description?: string;
  initial: boolean;
}

// Options every exporter honours -- both are proxies applied to the
// database before the exporter ever sees it (export.py's
// ExportOptions.get_proxy), so they're format-independent.
const UNIVERSAL_TOGGLES: ExportToggle[] = [
  {
    key: "private",
    label: "Exclude records marked private",
    initial: false,
  },
  {
    key: "reference",
    label: "Exclude records nothing links to",
    description:
      "Keeps every person, and only the events, places, sources and media something refers to.",
    initial: false,
  },
];

// Which extra options actually apply to which format. This map has to
// live here: the API exposes one flat set of query args for every
// exporter and says nothing about which exporter reads which, so the
// pairing is only recoverable from the plugins themselves (exportxml asks
// for get_use_compression(); the CSV writer reads the include_*/
// translate_headers attributes; include_media and include_witnesses exist
// for the third-party ged2 addon, per prepare_options' own comment).
// Anything not listed gets the universal pair alone, which is correct for
// GEDCOM, vCard, vCalendar, GeneWeb, Web Family Tree and JSON.
const FORMAT_TOGGLES: Record<string, ExportToggle[]> = {
  gramps: [
    {
      key: "compress",
      label: "Compress the file",
      description: "Gzips the XML. Gramps reads either form.",
      initial: true,
    },
  ],
  csv: [
    { key: "include_individuals", label: "Include individuals", initial: true },
    { key: "include_marriages", label: "Include marriages", initial: true },
    { key: "include_children", label: "Include children", initial: true },
    { key: "include_places", label: "Include places", initial: true },
    {
      key: "translate_headers",
      label: "Translate column headers",
      description: "Writes the header row in the server's language rather than in English.",
      initial: true,
    },
  ],
  ged2: [
    { key: "include_media", label: "Include media", initial: true },
    { key: "include_witnesses", label: "Include witnesses", initial: true },
  ],
};

/** Every boolean option that applies to one format, universal ones first. */
export function togglesFor(extension: string): ExportToggle[] {
  return [...UNIVERSAL_TOGGLES, ...(FORMAT_TOGGLES[extension] ?? [])];
}

/** Every toggle's initial value, across all formats -- the dialog holds
 * one flat map so switching format and back doesn't forget what was
 * ticked, and exportQueryParams() drops whatever doesn't apply. */
export function initialToggleValues(): Record<string, boolean> {
  const values: Record<string, boolean> = {};
  for (const toggle of [...UNIVERSAL_TOGGLES, ...Object.values(FORMAT_TOGGLES).flat()]) {
    values[toggle.key] = toggle.initial;
  }
  return values;
}

export interface ExportOptionState {
  toggles: Record<string, boolean>;
  living: string;
  yearsAfterDeath: number;
}

/** Turns dialog state into the query args for one format, sending only
 * the args that format actually reads. Every arg the API declares has a
 * server-side default, so omitting the rest is equivalent to sending them
 * unchanged -- it just keeps the request honest about what was asked for.
 *
 * `years_after_death` rides along only when a living-people restriction is
 * in force, since that's the only case it means anything: it widens who
 * counts as "living" (see LivingProxyDb). */
export function exportQueryParams(
  extension: string,
  state: ExportOptionState
): Record<string, string> {
  const params: Record<string, string> = { living: state.living };
  if (state.living !== "IncludeAll") {
    params.years_after_death = String(state.yearsAfterDeath);
  }
  for (const toggle of togglesFor(extension)) {
    const value = state.toggles[toggle.key] ?? toggle.initial;
    params[toggle.key] = value ? "true" : "false";
  }
  return params;
}
