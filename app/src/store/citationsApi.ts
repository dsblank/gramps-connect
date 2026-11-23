// Citations looked up by handle with their Source attached, for the details
// pane's Citations section (CitationsSection.tsx). A record's own detail
// request (extend=all) only resolves one level, so its citations arrive
// without their source; this is the one follow-up request that adds it,
// and the section only makes it when it's open.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { subscribeTreeChange } from "./treeChangeBus";

export interface CitationWithSource {
  handle: string;
  gramps_id?: string;
  page?: string;
  date?: unknown;
  confidence?: number;
  private?: boolean;
  source_handle?: string;
  extended?: { source?: { handle?: string; title?: string; author?: string } | null };
}

/** About 2.5 KB of URL per request (see treeData.ts). */
const HANDLES_PER_REQUEST = 100;
const CACHE_LIMIT = 50;

// Keyed by the sorted handle list: a record whose citations haven't changed
// reuses its entry; attaching or removing one changes the key. Edits to the
// citations or sources themselves clear it via live sync below.
const cache = new Map<string, CitationWithSource[]>();

subscribeTreeChange((n) => {
  if (n.table === "citation" || n.table === "source") cache.clear();
});

function cacheKey(handles: string[]): string {
  return [...handles].sort().join(",");
}

export function getCachedCitations(handles: string[]): CitationWithSource[] | undefined {
  return cache.get(cacheKey(handles));
}

/** GET /api/citations/?handles=…&extend=source_handle, in batches. Handles
 * that no longer exist (or that this user can't see) are left out, as the
 * endpoint does. */
export async function fetchCitationsWithSources(
  token: string,
  handles: string[],
  signal?: AbortSignal,
): Promise<CitationWithSource[]> {
  const key = cacheKey(handles);
  const hit = cache.get(key);
  if (hit) return hit;
  const chunks: string[][] = [];
  for (let i = 0; i < handles.length; i += HANDLES_PER_REQUEST) chunks.push(handles.slice(i, i + HANDLES_PER_REQUEST));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      const url = `${API_BASE}/api/citations/?handles=${chunk.map(encodeURIComponent).join(",")}&extend=source_handle`;
      const res = await apiFetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      return (await res.json()) as CitationWithSource[];
    }),
  );
  const result = pages.flat();
  cache.delete(key);
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}
