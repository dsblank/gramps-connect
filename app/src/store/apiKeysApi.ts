// The current user's API keys: gramps-web-api's labelled persistent tokens
// of the "sync" scope (v3.23.0, #1032/#1033), one per program or computer,
// at /users/-/access-tokens/sync/tokens/. A program trades its key for a
// short-lived access token at POST /token/sync/ -- one that can read the
// tree (private records included) and add, edit and delete objects, but
// not touch the account itself (ACCESS_TOKEN_SCOPE_PERMISSIONS). Each key
// can be removed on its own, unlike getApiKey()'s refresh-token key.
// Creating, listing and removing all need EditOwnUser.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

const BASE = `${API_BASE}/api/users/-/access-tokens/sync/tokens/`;

export interface ApiKeyInfo {
  id: number;
  label: string;
  /** ISO 8601, UTC */
  created_at: string;
  /** ISO 8601, UTC; null until a program has used the key */
  last_used_at: string | null;
}

/** A just-created key, with its value -- returned once, never again. */
export interface CreatedApiKey extends ApiKeyInfo {
  token: string;
}

/** Thrown by listApiKeys() for a server older than v3.23.0, which has no
 * such endpoint (404) -- callers hide the section rather than show an
 * error, the same way gramps-web's GrampsjsAccessTokens does. */
export class ApiKeysUnsupported extends Error {}

/** Oldest first, as the server returns them. */
export async function listApiKeys(token: string): Promise<ApiKeyInfo[]> {
  const res = await fetch(BASE, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) throw new ApiKeysUnsupported();
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

/** `label` must be unique among the user's keys (409 otherwise) and at most
 * 100 characters; a user holds at most 20 keys (409 "Maximum number of
 * access tokens reached"). The server's messages are readable as-is. */
export async function createApiKey(token: string, label: string): Promise<CreatedApiKey> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

/** 204 on success; 404 if it's already gone. */
export async function deleteApiKey(token: string, id: number): Promise<void> {
  const res = await fetch(`${BASE}${id}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

/** The server's created_at/last_used_at are UTC but serialized without a
 * zone ("2026-10-04T16:28:54"), which Date would read as local time --
 * pin them to UTC unless a zone is already there. */
export function parseServerUtc(iso: string): Date {
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
}
