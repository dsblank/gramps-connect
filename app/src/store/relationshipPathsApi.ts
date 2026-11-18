// getRelationshipPaths() (relationshipPath.ts) for the app itself, on the
// main thread: the same search the Gramplet worker runs for
// db.get_relationship_paths(), through apiFetch(), with labels built in the
// user's language. Results are kept per pair and revision, so reopening the
// same two people (or a re-render) costs nothing.
import { useEffect, useState } from "react";
import { getToken } from "../auth/auth";
import { API_BASE } from "../config";
import { t } from "../i18n/i18n";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { getRelationshipPaths, type PathPerson, type RelationshipPath, type ServerPath } from "./relationshipPath";

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return (await res.json()) as T;
}

export function fetchRelationshipPaths(
  handle1: string,
  handle2: string,
  options: { maxPaths?: number; bloodOnly?: boolean } = {},
): Promise<RelationshipPath[]> {
  return getRelationshipPaths(
    handle1,
    handle2,
    {
      fetchPaths: (h1, h2, { depth, max, bloodOnly }) =>
        getJson<ServerPath[]>(
          `/api/relations/${encodeURIComponent(h1)}/${encodeURIComponent(h2)}/paths?depth=${depth}&max=${max}${bloodOnly ? "&blood_only=true" : ""}`,
        ),
      async fetchPeople(handles) {
        const chunks: string[][] = [];
        for (let i = 0; i < handles.length; i += 100) chunks.push(handles.slice(i, i + 100));
        const pages = await Promise.all(
          chunks.map((chunk) =>
            getJson<PathPerson[]>(
              `/api/people/?handles=${chunk.map(encodeURIComponent).join(",")}&extend=parent_family_list&keys=handle,gender,parent_family_list,extended`,
            ),
          ),
        );
        return pages.flat();
      },
    },
    { ...options, inLawPattern: t("{0}'s {1}") },
  );
}

const cache = new Map<string, Promise<RelationshipPath[]>>();
const CACHE_LIMIT = 50;

function cached(handle1: string, handle2: string, maxPaths: number, revision: number): Promise<RelationshipPath[]> {
  const key = `${handle1}\n${handle2}\n${maxPaths}\n${revision}`;
  let paths = cache.get(key);
  if (!paths) {
    paths = fetchRelationshipPaths(handle1, handle2, { maxPaths });
    // A failure isn't kept: the next look tries again.
    paths.catch(() => cache.delete(key));
    cache.set(key, paths);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return paths;
}

export type RelationshipPathsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; paths: RelationshipPath[] }
  | { status: "error"; message: string };

/** The paths from handle1 to handle2, shortest first. Waits `delayMs`
 * before asking, so moving quickly through a list only searches for the
 * person it stops on. `revision` starts a fresh search after an edit. */
export function useRelationshipPaths(
  handle1: string | null,
  handle2: string | null,
  { maxPaths = 5, revision = 0, delayMs = 0 }: { maxPaths?: number; revision?: number; delayMs?: number } = {},
): RelationshipPathsState {
  const [state, setState] = useState<RelationshipPathsState>({ status: "idle" });
  useEffect(() => {
    if (!handle1 || !handle2 || handle1 === handle2) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      cached(handle1, handle2, maxPaths, revision).then(
        (paths) => !cancelled && setState({ status: "done", paths }),
        (e: unknown) => !cancelled && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }),
      );
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle1, handle2, maxPaths, revision, delayMs]);
  return state;
}
