// What the server can do, judged from its versions (/api/metadata/'s
// gramps.version and gramps_webapi.version) -- gramps-web-api has no
// capability list for this.

/** Gramps' lunisolar calendars (Chinese, Korean, Vietnamese Lunar:
 * calendars 7-9) arrive in Gramps 6.2. An older server has no conversion or
 * display code for them: it would store such a date, but couldn't format or
 * sort it. */
export const LUNAR_CALENDARS_SINCE: readonly [number, number] = [6, 2];

/** Is version ("6.2.0", "6.2.0-beta1") at least [major, minor]? An
 * unreadable version counts as older. Works for any major.minor version,
 * gramps-web-api's included. */
export function grampsVersionAtLeast(version: string, [major, minor]: readonly [number, number]): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return false;
  const [vMajor, vMinor] = [Number(m[1]), Number(m[2])];
  return vMajor > major || (vMajor === major && vMinor >= minor);
}

export function supportsLunarCalendars(grampsVersion: string): boolean {
  return grampsVersionAtLeast(grampsVersion, LUNAR_CALENDARS_SINCE);
}

/** POST /objects/delete-by-handle/?background=true (gramps-web-api
 * v3.25.0, #1131): a large delete as a task with progress, in one
 * transaction. An older server rejects the unknown `background` query arg
 * with a 422. */
export const BACKGROUND_DELETE_SINCE: readonly [number, number] = [3, 25];

export function supportsBackgroundDelete(webApiVersion: string): boolean {
  return grampsVersionAtLeast(webApiVersion, BACKGROUND_DELETE_SINCE);
}

/** The last gramps-web-api release whose /query/ takes `order_by` only as
 * {"column", "direction"} objects. Newer releases take GOQL strings
 * ("surname", "-change") and reject the objects (gramps-web-api#1164).
 * 3.25.3 shipped without #1164, so it is still on the object side. */
export const LAST_OBJECT_ORDER_BY_VERSION: readonly [number, number, number] = [3, 25, 3];

/** Is version ("3.26.0", "3.25.3rc1") newer than [major, minor, patch]?
 * An unreadable version counts as not newer. */
export function versionAfter(version: string, [major, minor, patch]: readonly [number, number, number]): boolean {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  const limit = [major, minor, patch];
  for (let i = 0; i < 3; i++) if (v[i] !== limit[i]) return v[i] > limit[i];
  return false;
}

export function supportsOrderByStrings(webApiVersion: string): boolean {
  return versionAfter(webApiVersion, LAST_OBJECT_ORDER_BY_VERSION);
}

/** Is this 422 body the server rejecting `order_by` for being in the
 * wrong form? Both forms fail schema validation the same way -- an older
 * server given strings, or a newer one given objects -- with the field
 * named under `error.messages.json.order_by`:
 * `{"error": {"code": 422, "messages": {"json": {"order_by": {"0": ...}}}}}`.
 * (A newer server also reports a bad GOQL sort string there; retrying that
 * one in the other form just fails again, which the caller handles.) */
export function isOrderByFormError(status: number, body: string): boolean {
  if (status !== 422) return false;
  try {
    const order = JSON.parse(body)?.error?.messages?.json?.order_by;
    return order !== undefined && order !== null;
  } catch {
    return false;
  }
}

/** Send a /query/ request, retrying once in the other `order_by` form when
 * the server rejects the one `guess` picked (see isOrderByFormError()).
 * The version check is only a guess: gramps-web-api#1164, the change to
 * strings, isn't in any release yet, so a release past
 * LAST_OBJECT_ORDER_BY_VERSION may still want objects. `remember` is told
 * the form that worked after a retry, so later requests start with it. If
 * the retry fails too, the first response comes back -- its error is about
 * the request as written. */
export async function withOrderByFallback(
  guess: boolean,
  send: (strings: boolean) => Promise<Response>,
  remember: (strings: boolean) => void
): Promise<Response> {
  const res = await send(guess);
  if (res.status !== 422 || !isOrderByFormError(res.status, await res.clone().text())) return res;
  const retry = await send(!guess);
  if (!retry.ok) return res;
  remember(!guess);
  return retry;
}
