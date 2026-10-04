// GET /api/metadata/ -- gramps-web-api's description of the server, the
// tree it's serving and which optional features are configured (see its
// resources/metadata.py). Two callers with quite different needs: staleness
// detection (cacheMeta.ts, which reads database identity + object_counts)
// and Help > System Information, which reports the version block for a bug
// report.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

/** Only the fields this app reads -- the response carries a good deal more
 * (researcher, surnames, search-index state, OCR/chat availability), and
 * everything here is optional because a field's absence is a real,
 * expected answer: an older server predating it, or a feature this
 * deployment doesn't build. */
export interface Metadata {
  database?: { id?: string; name?: string; type?: string; version?: string };
  gramps?: { version?: string };
  gramps_webapi?: { version?: string; schema?: string };
  /** Gramps Object Query Language, the library behind the fast `/query/`
   * endpoints this whole client is built on. The response also carries
   * other query-language packages this app never uses, which
   * systemInfoLines leaves out. Older servers don't report this one at
   * all. */
  gramps_object_query_language?: { version?: string };
  locale?: { lang?: string; language?: string; description?: string };
  object_counts?: Record<string, number>;
  server?: {
    multi_tree?: boolean;
    task_queue?: boolean;
    semantic_search?: boolean;
    /** whether outgoing email is configured (v3.22.0+) */
    email?: boolean;
    /** which non-image files get thumbnails (v3.22.0+) */
    thumbnails?: { pdf?: boolean; video?: boolean };
    /** files above this size get no thumbnail (v3.22.0+) */
    max_thumbnail_file_bytes?: number;
  };
  /** Deprecated server settings in use (v3.22.0+). Only sent to someone who
   * can act on it -- a site admin, or a single-tree server's owner -- so
   * its absence is not "none". */
  deprecations?: Deprecation[];
}

/** One deprecated server setting, as gramps-web-api's
 * api/deprecations.py reports it. */
export interface Deprecation {
  option: string;
  replacement?: string;
  message?: string;
  removed_in?: string;
}

/** The block Help > System Information shows and copies: one fact per
 * line, versions first and then the server's optional features, following
 * gramps-web's own System Information panel in order and wording --
 * deliberately, so a maintainer reading a bug report can scan it without
 * being told which frontend it came from.
 *
 * Not identical to that panel, though. Our own line replaces "Gramps Web
 * Frontend", and the lines describing things this client never touches are
 * dropped rather than copied for symmetry: Sifts's own version/config
 * fields here (View > Search all does now call GET /api/search/, see
 * searchApi.ts, but doesn't read anything off this metadata response to do
 * it), OCR, chat and face detection (nothing here reaches any of them),
 * multi-tree (on its way to being the assumption here rather than a mode
 * worth reporting), and the query languages other than Gramps Object Query
 * Language, which every list in this app queries through. What's left is
 * what could plausibly explain a bug in *this* app: thumbnails (shown all
 * over it -- a PDF or video with none is the question these lines answer)
 * and email (the admin tools' password-reset mail can't go out without
 * it).
 *
 * Any deprecated server settings follow last, one line each, so they
 * travel with a bug report too; the dialog also shows them in full (see
 * deprecationWarnings).
 *
 * A missing version is omitted rather than printed as "unknown": on an
 * older server, or one built without an optional package, the absence *is*
 * the answer and a line claiming otherwise would mislead. Same rule for
 * the feature flag -- "task queue: false" and "this server is too old to
 * say" are different facts. */
export function systemInfoLines(metadata: Metadata, appVersion: string): string[] {
  const lines: string[] = [];
  const version = (label: string, value: string | undefined) => {
    if (value) lines.push(`${label} ${value}`);
  };

  version("Gramps", metadata.gramps?.version);
  version("Gramps Web API", metadata.gramps_webapi?.version);
  version("Gramps Connect", appVersion);
  version("Gramps Object Query Language", metadata.gramps_object_query_language?.version);
  if (metadata.locale?.lang) lines.push(`locale: ${metadata.locale.lang}`);
  const flag = (label: string, value: boolean | undefined) => {
    if (typeof value === "boolean") lines.push(`${label}: ${value}`);
  };
  flag("task queue", metadata.server?.task_queue);
  flag("email", metadata.server?.email);
  flag("PDF thumbnails", metadata.server?.thumbnails?.pdf);
  flag("video thumbnails", metadata.server?.thumbnails?.video);
  const maxThumb = metadata.server?.max_thumbnail_file_bytes;
  if (typeof maxThumb === "number") lines.push(`max thumbnail file size: ${formatBytes(maxThumb)}`);
  for (const d of deprecationWarnings(metadata)) {
    lines.push(`deprecated setting: ${d.option}${d.replacement ? ` -> ${d.replacement}` : ""}`);
  }
  return lines;
}

/** The deprecated server settings to warn about -- empty both when there
 * are none and when this user isn't shown them. */
export function deprecationWarnings(metadata: Metadata): Deprecation[] {
  return Array.isArray(metadata.deprecations) ? metadata.deprecations.filter((d) => d?.option) : [];
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB` : `${bytes} bytes`;
}

export async function fetchMetadata(token: string): Promise<Metadata> {
  const res = await fetch(`${API_BASE}/api/metadata/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Status only, deliberately: the body of a failure here is either a JWT
  // error envelope or an HTML error page, and neither says anything to the
  // reader that the status code doesn't say better.
  if (!res.ok) throw new Error(`metadata fetch failed: ${res.status}`);
  return res.json();
}

/** GET/PUT /api/metadata/researcher/ -- the tree owner's own contact info
 * (name/address/email/phone), conventionally what GEDCOM export headers
 * (SOUR/SUBM) carry. Mirrors desktop Gramps' own "Edit Researcher
 * Information" tool (`ownereditor.py`) field set: `addr` is one free-text
 * street-address line, distinct from the structured locality/city/state/
 * country/postal fields alongside it. GET needs no particular permission
 * beyond being logged in; PUT requires EditTree, same tier as
 * OwnerAdministrationDialog.tsx's tree-rename control. */
export interface Researcher {
  name?: string;
  addr?: string;
  locality?: string;
  city?: string;
  state?: string;
  country?: string;
  postal?: string;
  phone?: string;
  email?: string;
}

export async function fetchResearcher(token: string): Promise<Researcher> {
  const res = await fetch(`${API_BASE}/api/metadata/researcher/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export async function updateResearcher(token: string, data: Researcher): Promise<Researcher> {
  const res = await fetch(`${API_BASE}/api/metadata/researcher/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}
