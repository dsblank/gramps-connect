// Self-service "own user" endpoints (gramps_webapi/api/resources/user.py) --
// the special `-` user_name segment resolves server-side to the caller's own
// account via the JWT, so these never need a username in the URL. Every role
// from ROLE_GUEST up carries EditOwnUser (auth/const.py's PERMISSIONS chain),
// so any logged-in user can reach all three; ProfileDialog.tsx still checks
// hasPermissions("EditOwnUser") the same way every other mutating control in
// the app does.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

export interface OwnUser {
  name: string;
  full_name?: string;
  email?: string;
  role: number;
}

export async function fetchOwnUser(token: string): Promise<OwnUser> {
  const res = await fetch(`${API_BASE}/api/users/-/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

/** Each field is independently optional server-side (UserPutBodyArgs) --
 * callers should only send what actually changed, matching gramps-web's own
 * per-field PUTs (GrampsjsViewSettingsUser.js). Deliberately typed without
 * `role`/`tree`: those need EditUserRole/EditUserTree, not EditOwnUser, so a
 * self-service dialog must never offer them. */
export async function updateOwnUser(
  token: string,
  fields: { email?: string; full_name?: string; name_new?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/-/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

/** Requires re-proving the current password server-side (authorized(name,
 * old_password)) even though the request is already authenticated -- this is
 * the "change while logged in" flow, distinct from the emailed
 * password-reset link's own scoped-token endpoint. */
export async function changeOwnPassword(
  token: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/-/password/change`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}
