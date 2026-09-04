// Site-wide administration endpoints: config (SMTP/base-URL settings),
// multi-tree management, and cross-tree user management. Every one of these
// is ROLE_ADMIN-only (gramps_webapi/auth/const.py's PERMISSIONS[ROLE_ADMIN]
// tier -- ViewSettings/EditSettings, ViewOtherTree/EditOtherTree/AddTree/
// DisableTree, ViewOtherTreeUser/AddOtherTreeUser/EditOtherTreeUser(Role)/
// DeleteOtherTreeUser/EditUserTree/MakeAdmin), distinct from the
// ROLE_OWNER-level per-tree maintenance (reindex/repair/upgrade schema/
// restore-from-backup/delete-all-objects) that AdministrationDialog.tsx
// deliberately does not cover -- see its own doc comment.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// -- Site config (GET /api/config/, GET/PUT/DELETE /api/config/<key>/) --

// gramps_webapi's DB_CONFIG_ALLOWED_KEYS (const.py) -- the only keys
// ConfigResource's PUT/DELETE will accept; anything else 404s.
export const CONFIG_KEYS = [
  "EMAIL_HOST",
  "EMAIL_PORT",
  "EMAIL_HOST_USER",
  "EMAIL_HOST_PASSWORD",
  "DEFAULT_FROM_EMAIL",
  "BASE_URL",
  "FRONTEND_URL",
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/** Only keys that have actually been set come back -- an absent key means
 * "unset", not "empty string" (config_get_all() only queries rows that
 * exist). */
export async function fetchConfig(token: string): Promise<Partial<Record<ConfigKey, string>>> {
  const res = await fetch(`${API_BASE}/api/config/`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export async function setConfigValue(token: string, key: ConfigKey, value: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/config/${encodeURIComponent(key)}/`, {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export async function deleteConfigValue(token: string, key: ConfigKey): Promise<void> {
  const res = await fetch(`${API_BASE}/api/config/${encodeURIComponent(key)}/`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

// -- Trees (GET/POST /api/trees/, POST .../enable, .../disable) --

export interface Tree {
  id: string;
  name: string;
  enabled: boolean;
  quota_media?: number | null;
  quota_people?: number | null;
  usage_media?: number;
  usage_people?: number;
  min_role_ai?: number | null;
}

/** Requires ViewOtherTree to see every tree -- an Owner calling this (who
 * only has ViewOtherTree false) gets back just their own tree, per
 * TreesResource.get()'s own fallback. AdministrationDialog only renders this
 * tab behind hasPermissions("ViewOtherTree") so that fallback never shows. */
export async function fetchTrees(token: string): Promise<Tree[]> {
  const res = await fetch(`${API_BASE}/api/trees/`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

/** 405s server-side outside TREE_MULTI mode -- callers should check
 * metadata's `server.multi_tree` first (fetchMetadata in metadataApi.ts)
 * and hide the control entirely rather than let this throw. */
export async function createTree(token: string, name: string): Promise<Tree> {
  const res = await fetch(`${API_BASE}/api/trees/`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export async function renameTree(token: string, treeId: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/trees/${encodeURIComponent(treeId)}`, {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export async function setTreeEnabled(token: string, treeId: string, enabled: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/api/trees/${encodeURIComponent(treeId)}/${enabled ? "enable" : "disable"}`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

// -- Users (GET/POST /api/users/, PUT/POST/DELETE /api/users/<name>/) --

export interface AdminUser {
  name: string;
  full_name?: string;
  email?: string;
  role: number;
  tree?: string | null;
}

// gramps-web's own role picker order (GrampsjsFormUser.js) -- Unconfirmed
// and Disabled included so an admin can approve a pending registration or
// disable an account from the same Select, not just assign working roles.
export const ROLE_LABELS: Record<number, string> = {
  [-2]: "Unconfirmed",
  [-1]: "Disabled",
  0: "Guest",
  1: "Member",
  2: "Contributor",
  3: "Editor",
  4: "Owner",
  5: "Administrator",
};

/** Every user on the server, across every tree -- ViewOtherTreeUser
 * (ROLE_ADMIN) makes UsersResource.get() return the all_trees=True listing
 * rather than scoping to the caller's own tree. */
export async function fetchAllUsers(token: string): Promise<AdminUser[]> {
  const res = await fetch(`${API_BASE}/api/users/`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export async function createUser(
  token: string,
  user: { name: string; email: string; full_name: string; password: string; role: number; tree?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(user.name)}/`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      email: user.email,
      full_name: user.full_name,
      password: user.password,
      role: user.role,
      tree: user.tree,
    }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

/** Every field is independently optional server-side (UserPutBodyArgs) --
 * send only what changed. Raising `role` to Administrator (>=5) additionally
 * needs MakeAdmin, and reassigning `tree` needs EditUserTree -- both are
 * ROLE_ADMIN-only anyway, so a caller who reached this dialog already has
 * them, but the server still re-checks per field. */
export async function updateUser(
  token: string,
  name: string,
  fields: { email?: string; full_name?: string; name_new?: string; role?: number; tree?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(name)}/`, {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

/** POST /api/users/<name>/password/reset/trigger/ -- emails the user a
 * one-time password-reset link (UserTriggerResetPasswordResource). Needs no
 * permission at all server-side (it's the same "forgot password" flow a
 * logged-out visitor triggers for themselves) and always returns 201
 * whether or not the username/email exist, so there's no way to directly
 * set another user's password from here -- PUT /api/users/<name>/ has no
 * password field, and the "change my own password" endpoint requires
 * knowing the *current* password (see usersApi.ts's changeOwnPassword).
 * This is the only admin/owner-initiated path to a changed password for
 * someone else. */
export async function triggerPasswordReset(token: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(name)}/password/reset/trigger/`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export async function deleteUser(token: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(name)}/`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}
