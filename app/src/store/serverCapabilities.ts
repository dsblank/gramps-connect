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
