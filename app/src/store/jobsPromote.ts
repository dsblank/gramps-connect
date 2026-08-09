// Client-side promotion of a finished report/export job's file into a
// tagged Media object -- see the plan's "Client-side promotion: file ->
// Media" section. Driven by store/jobsPoll.ts once a tracked task reaches
// Celery SUCCESS.
import { API_BASE } from "../config";
import { downloadProcessedFile, uploadMedia, getOrCreateTagHandle, tagAndDescribeMedia } from "./jobsApi";

export type JobKind = "report" | "export";

export interface PromoteResult {
  handle: string;
  desc: string;
}

const REPORT_URL_RE = /^\/api\/reports\/([^/]+)\/file\/processed\//;
const EXPORT_URL_RE = /^\/api\/exporters\/([^/]+)\/file\/processed\//;

// Gramps plugin display names carry a GTK mnemonic marker (an underscore
// before the accelerator letter, e.g. "GE_DCOM", "_Web Family Tree") --
// meaningless outside a desktop menu, so it's stripped for use in a Media
// desc. A literal underscore (rare) would need doubling to survive; none
// of Gramps' own report/exporter names do.
function stripMnemonic(name: string): string {
  return name.replace(/_/g, "");
}

/** Classifies a finished job's result `url` and derives a generic,
 * non-subject-specific label for it -- report/export *type* is recoverable
 * this way even once the dispatching tab (and its in-memory `options`) is
 * long gone, per the plan's "Closed-tab recovery" decision. Used only when
 * the caller has nothing more specific: jobsPoll.ts's catch-up sweep. The
 * dispatch-scoped loop instead builds a richer desc itself, from the
 * `options` it still has in memory at that point. */
export async function describeGenericJob(token: string, kind: JobKind, url: string): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 10);
  const [urlRe, apiPath, idFallback] =
    kind === "report"
      ? ([REPORT_URL_RE, "reports", "Report"] as const)
      : ([EXPORT_URL_RE, "exporters", "Export"] as const);
  const id = urlRe.exec(url)?.[1];
  let name = id ?? idFallback;
  if (id) {
    try {
      const query = kind === "report" ? "?include_help=false" : "";
      const res = await fetch(`${API_BASE}/api/${apiPath}/${encodeURIComponent(id)}${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) name = stripMnemonic(((await res.json()).name as string | undefined) ?? name);
    } catch {
      // Falls back to the raw id -- this is only ever a display label,
      // never used to drive another request.
    }
  }
  const label = kind === "report" ? name : `${name} export`;
  return `${label} — ${stamp}`;
}

/** Promotes a finished report/export job's processed file to a tagged Media
 * object (plan §1, steps 1-4): download the processed file, upload it as
 * Media, get-or-create the `report`/`export` Tag, then set `desc` and
 * attach the tag. `url` is the task result's own
 * `.../file/processed/<uuid>.<ext>` path; `desc` is the human label to set
 * (see describeGenericJob for the orphan-recovery case, or a caller-built
 * subject-specific one for the live dispatch-scoped case).
 *
 * Returns null if the processed file was already claimed -- an earlier
 * poll tick, or another tab/session of the same user, racing to promote
 * the same job -- a normal, silent outcome of the endpoint's own
 * delete-on-read behavior (see jobsApi.ts's downloadProcessedFile), not a
 * failure. */
export async function promoteJob(token: string, kind: JobKind, url: string, desc: string): Promise<PromoteResult | null> {
  const file = await downloadProcessedFile(token, url);
  if (!file) return null;
  const handle = await uploadMedia(token, file.blob, file.contentType);
  const tagHandle = await getOrCreateTagHandle(token, kind);
  await tagAndDescribeMedia(token, handle, desc, tagHandle);
  return { handle, desc };
}
