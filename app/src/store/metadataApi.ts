// GET /api/metadata/ -- gramps-web-api's description of the server, the
// tree it's serving and which optional features are configured (see its
// resources/metadata.py). Two callers with quite different needs: staleness
// detection (cacheMeta.ts, which reads database identity + object_counts)
// and Help > System Information, which reports the version block for a bug
// report.
import { API_BASE } from "../config";

/** Only the fields this app reads -- the response carries a good deal more
 * (researcher, surnames, search-index state, OCR/chat availability), and
 * everything here is optional because a field's absence is a real,
 * expected answer: an older server predating it, or a feature this
 * deployment doesn't build. */
export interface Metadata {
  database?: { id?: string; name?: string; type?: string; version?: string };
  gramps?: { version?: string };
  gramps_webapi?: { version?: string; schema?: string };
  /** The library behind the fast `/query/` endpoints this whole client is
   * built on. Not to be confused with the two similarly-named packages the
   * same response also carries and this app has no use for: `object_ql`,
   * and `gramps_ql` (the `?gql=` search filter language). Older servers
   * don't report this one at all; see systemInfoLines. */
  gramps_object_query_language?: { version?: string };
  locale?: { lang?: string; language?: string; description?: string };
  object_counts?: Record<string, number>;
  server?: { multi_tree?: boolean; task_queue?: boolean };
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
 * it), OCR and chat (nothing here reaches either), multi-tree (on its way
 * to being the assumption here rather than a mode worth reporting), and
 * Gramps QL, the `?gql=` filter
 * language, which nothing here sends -- every list in this app queries
 * through `where_expr`, i.e. gramps-object-query-language, which is the
 * one below it and a different package entirely. What's left is what could
 * plausibly explain a bug in *this* app.
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
  version("Gramps Object QL", metadata.gramps_object_query_language?.version);
  if (metadata.locale?.lang) lines.push(`locale: ${metadata.locale.lang}`);
  if (typeof metadata.server?.task_queue === "boolean") {
    lines.push(`task queue: ${metadata.server.task_queue}`);
  }
  return lines;
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
