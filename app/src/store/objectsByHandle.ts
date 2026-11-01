// GET /api/<type>/?handles=a,b,c&profile=all -- a known set of records of
// one type in a single request, in the same raw-object-plus-profile shape
// /api/search/ hits carry, so the result cards (ObjectResultList.tsx) render
// them unchanged. For View > Visited (and Bookmarks next), which start from
// a list of handles rather than a query. Handles that don't exist (deleted,
// or private to this user) are silently left out by the server.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { endpointBaseFor } from "./objectDetail";
import { VIEWS } from "./views";
import { getI18nSnapshot } from "../i18n/i18n";

/** Handles per request. A Gramps handle is ~25 characters, so this keeps
 * the URL around 1.5 KB; a few hundred at once got 414 URI Too Long. */
const CHUNK = 50;

export type RawRecord = Record<string, unknown> & { handle: string; profile?: Record<string, unknown> };

/** Fetches `handles` of VIEWS key `type`. Returns handle -> record for the
 * ones that exist; a handle missing from the map doesn't. */
export async function fetchObjectsByHandle(
  token: string,
  type: string,
  handles: string[],
): Promise<Map<string, RawRecord>> {
  const view = VIEWS.find((v) => v.key === type);
  if (!view) throw new Error(`unknown object type: ${type}`);
  const base = endpointBaseFor(view);
  const found = new Map<string, RawRecord>();
  for (let i = 0; i < handles.length; i += CHUNK) {
    const params = new URLSearchParams({ handles: handles.slice(i, i + CHUNK).join(","), profile: "all" });
    // Profiles' dates and types in the UI language, as on Search all.
    const { lang } = getI18nSnapshot();
    if (lang.length <= 5) params.set("locale", lang);
    const res = await apiFetch(`${API_BASE}${base}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await parseErrorMessage(res));
    for (const obj of (await res.json()) as RawRecord[]) found.set(obj.handle, obj);
  }
  return found;
}
