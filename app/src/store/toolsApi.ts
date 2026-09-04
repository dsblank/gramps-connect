// ROLE_OWNER-level per-tree maintenance actions -- deliberately kept out of
// adminApi.ts/AdministrationDialog.tsx, which is scoped to ROLE_ADMIN
// (site-wide) capabilities only. Reindex, check & repair, and schema
// upgrade are all plain ProtectedResource endpoints server-side (no fresh
// JWT needed); restore-from-backup is the exception, same
// FreshProtectedResource requirement as deleteApi.ts's delete-all-objects.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { FreshTokenRequiredError } from "./deleteApi";

export type TaskPostResult = { kind: "task"; task: { id: string } } | { kind: "done"; result: unknown };

async function postTask(token: string, url: string): Promise<TaskPostResult> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 202) {
    const body = await res.json();
    return { kind: "task", task: body.task };
  }
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const result = res.status === 201 || res.headers.get("content-length") === "0" ? null : await res.json();
  return { kind: "done", result };
}

/** POST /api/search/index/ -- full vs incremental, full-text vs semantic
 * (the latter only meaningful when the server has an embedding model
 * configured, see metadataApi.ts's `server.semantic_search`). */
export function triggerReindex(token: string, full: boolean, semantic: boolean): Promise<TaskPostResult> {
  return postTask(token, `/api/search/index/?full=${full}&semantic=${semantic}`);
}

/** POST /api/trees/-/repair -- Gramps' own CheckIntegrity tool against the
 * current tree (own tree only; RepairTree doesn't extend to other trees). */
export function checkRepairDatabase(token: string): Promise<TaskPostResult> {
  return postTask(token, "/api/trees/-/repair");
}

/** POST /api/trees/-/migrate -- upgrades the tree's (and its undo log's)
 * on-disk schema version. Despite the class name UpgradeTreeSchemaResource,
 * the route itself is .../migrate, not .../upgrade_schema. */
export function upgradeSchema(token: string): Promise<TaskPostResult> {
  return postTask(token, "/api/trees/-/migrate");
}

export interface RestoreSummary {
  to_add?: Record<string, number>;
  to_update?: Record<string, number>;
  to_delete?: Record<string, number>;
  unchanged?: Record<string, number>;
}

export type RestorePostResult = { kind: "task"; task: { id: string } } | { kind: "summary"; summary: RestoreSummary };

/** POST /api/importers/gramps/file/restore -- resets the tree to exactly
 * match an uploaded Gramps XML backup (dry_run=true previews the
 * changeset). FreshProtectedResource, same as deleteApi.ts's
 * deleteAllObjects -- a 401 here means the caller should re-login (see
 * DeleteAllDialog.tsx's own handling) rather than a generic failure. */
async function postRestore(token: string, file: File, dryRun: boolean): Promise<RestorePostResult> {
  const res = await fetch(`${API_BASE}/api/importers/gramps/file/restore?dry_run=${dryRun}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: file,
  });
  if (res.status === 401) {
    throw new FreshTokenRequiredError();
  }
  if (res.status === 202) {
    const body = await res.json();
    return { kind: "task", task: body.task };
  }
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return { kind: "summary", summary: await res.json() };
}

export function previewRestore(token: string, file: File): Promise<RestorePostResult> {
  return postRestore(token, file, true);
}

export function runRestore(token: string, file: File): Promise<RestorePostResult> {
  return postRestore(token, file, false);
}
