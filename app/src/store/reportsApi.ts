// Thin wrappers around gramps-web-api's existing reports endpoints
// (resources/reports.py) -- the *front* of the report pipeline whose back
// half already exists in jobsPoll.ts/jobsPromote.ts. Nothing new
// server-side; same shape as importApi.ts's wrappers around the importer.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

/** gramps.gen.plug.report's CATEGORY_* constants, which the API passes
 * through as `category`, paired with the section names desktop Gramps
 * shows for them (gramps/gen/plug/report/_constants.py's
 * standalone_categories). Only TEXT, DRAW and GRAPHVIZ are reachable
 * through the API today -- get_reports() drops any category missing from
 * gramps_webapi.const's REPORT_DEFAULTS -- but the rest cost nothing to
 * name and keep a newly-supported category from showing up unlabelled. */
export const REPORT_CATEGORIES: { category: number; label: string }[] = [
  { category: 0, label: "Text Reports" },
  { category: 1, label: "Graphical Reports" },
  { category: 2, label: "Code Generators" },
  { category: 3, label: "Web Pages" },
  { category: 4, label: "Books" },
  { category: 5, label: "Graphs" },
  { category: 6, label: "Trees" },
];

export interface ReportSummary {
  id: string;
  name: string;
  description: string;
  category: number;
}

export interface ReportDetail extends ReportSummary {
  options_dict: Record<string, unknown>;
  options_help: Record<string, unknown[]>;
}

/** GET /api/reports/ without the options help -- the menu only needs each
 * report's name and category, and building the help for all 25 means
 * instantiating every report's option class against the database (which,
 * for the person-valued options, walks every person in the tree). */
export async function listReports(token: string): Promise<ReportSummary[]> {
  const res = await fetch(`${API_BASE}/api/reports/?include_help=false`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

/** GET /api/reports/<id> -- with the options help this time (the endpoint
 * includes it by default), which is what parseReportOptions() renders. */
export async function getReport(token: string, id: string): Promise<ReportDetail> {
  const res = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export type RunReportResult =
  | { kind: "task"; taskId: string }
  | { kind: "done"; url: string };

/** POST /api/reports/<id>/file?options=<json>.
 *
 * Two possible successes, exactly as importApi.ts's postImportFile() has
 * to handle: 202 with a task to poll when a Celery broker is configured,
 * or 201 with the finished file's own `url` when run_task() fell back to
 * running it inline. Callers hand the first to trackJob() and the second
 * straight to promoteJob() -- both end at the same tagged Media object. */
export async function runReport(
  token: string,
  id: string,
  options: Record<string, string>
): Promise<RunReportResult> {
  const query = new URLSearchParams({ options: JSON.stringify(options) });
  const res = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}/file?${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = await res.json();
  if (res.status === 202) return { kind: "task", taskId: body.task.id };
  return { kind: "done", url: body.url };
}
