// What the server's Gramps can do, judged from its version (/api/metadata/'s
// gramps.version) -- gramps-web-api has no capability list for this.

/** Gramps' lunisolar calendars (Chinese, Korean, Vietnamese Lunar:
 * calendars 7-9) arrive in Gramps 6.2. An older server has no conversion or
 * display code for them: it would store such a date, but couldn't format or
 * sort it. */
export const LUNAR_CALENDARS_SINCE: readonly [number, number] = [6, 2];

/** Is version ("6.2.0", "6.2.0-beta1") at least [major, minor]? An
 * unreadable version counts as older. */
export function grampsVersionAtLeast(version: string, [major, minor]: readonly [number, number]): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return false;
  const [vMajor, vMinor] = [Number(m[1]), Number(m[2])];
  return vMajor > major || (vMajor === major && vMinor >= minor);
}

export function supportsLunarCalendars(grampsVersion: string): boolean {
  return grampsVersionAtLeast(grampsVersion, LUNAR_CALENDARS_SINCE);
}
