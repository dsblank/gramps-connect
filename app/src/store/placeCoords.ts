/** Parses one Place.lat or Place.long string the way Gramps desktop's own
 * conv_lat_lon (gramps/gen/utils/place.py) does, so a place typed there as
 * `42° 41′ 55″ N` lands where Gramps puts it rather than at a plain
 * parseFloat's 42 (which also dropped every S/W sign). Accepted forms:
 *
 *   42.6986          decimal degrees, optionally signed
 *   42:41:55         degrees:minutes[:seconds], optionally signed
 *   42°41'55"N       classic DMS with a trailing (or leading) direction;
 *                    ° º or # for degrees, ′ or ' for minutes, ″ " or ''
 *                    for seconds, decimal minutes allowed without seconds
 *   42.6986N         decimal with a trailing (or leading) direction
 *
 * Gramps also accepts its UI language's own direction letters; only
 * "O" (ouest/oeste/ovest) is taken here beyond N/S/E/W, since the locale
 * that typed the value isn't known and it's the one that can't be confused
 * with another direction. Returns null for anything unparseable. */
export function parseCoordinate(text: string, kind: "lat" | "long"): number | null {
  let value = text.trim();
  if (kind === "long") value = value.replace(/O/g, "W");
  // A leading direction letter (N50°52'...) moves to the end.
  if (value.length > 1 && /^\p{L}/u.test(value)) value = value.slice(1) + value[0];
  return asFloat(value) ?? fromColon(value) ?? fromClassic(value, kind) ?? fromSuffixed(value, kind);
}

const FLOAT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const UINT = /^\+?\d+$/;

function asFloat(s: string): number | null {
  const t = s.trim();
  return FLOAT.test(t) ? Number(t) : null;
}

function asUint(s: string): number | null {
  const t = s.trim();
  return UINT.test(t) ? Number(t) : null;
}

function combine(negative: boolean, degs: number, mins: number, secs: number): number {
  const v = degs + mins / 60 + secs / 3600;
  return negative ? -v : v;
}

function fromColon(s: string): number | null {
  const parts = s.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  let head = parts[0].trim();
  let negative = false;
  if (head.startsWith("+") || head.startsWith("-")) {
    negative = head[0] === "-";
    head = head.slice(1).trim();
  }
  const degs = asUint(head);
  const mins = asUint(parts[1]);
  if (degs == null || mins == null || mins >= 60) return null;
  let secs = 0;
  if (parts.length === 3) {
    const v = asFloat(parts[2]);
    if (v == null || v < 0 || v >= 60) return null;
    secs = v;
  }
  return combine(negative, degs, mins, secs);
}

function fromClassic(s: string, kind: "lat" | "long"): number | null {
  if (s.includes("_")) return null;
  const norm = s
    .replace(/[°º#]/g, "_")
    .replace(/''/g, '"')
    .replace(/″/g, '"')
    .replace(/′/g, "'")
    .replace(/\s/g, "");
  const degParts = norm.split("_");
  if (degParts.length !== 2) return null;
  const degs = asUint(degParts[0]);
  if (degs == null) return null;
  let rest = degParts[1];
  let mins = 0;
  let secs = 0;
  let decimalMinutes = false;
  const minParts = rest.split("'");
  if (minParts.length > 2) return null;
  if (minParts.length === 2) {
    const [m, after] = minParts;
    const dot = m.indexOf(".");
    if (dot > 0) {
      // Decimal minutes (52.3456') carry the seconds themselves.
      const whole = asUint(m.slice(0, dot));
      const frac = asFloat("0." + m.slice(dot + 1));
      if (whole == null || frac == null || whole >= 60) return null;
      mins = whole;
      secs = frac * 60;
      decimalMinutes = true;
      rest = after;
    } else {
      const v = asUint(m);
      if (v == null || v >= 60) return null;
      mins = v;
      rest = after;
    }
  }
  const secParts = rest.split('"');
  if (secParts.length > 2) return null;
  if (secParts.length === 2) {
    if (decimalMinutes) return null;
    const v = asFloat(secParts[0]);
    if (v == null || v < 0 || v >= 60) return null;
    secs = v;
    rest = secParts[1];
  }
  const dir = rest;
  if (kind === "lat" && (dir === "N" || dir === "S")) return combine(dir === "S", degs, mins, secs);
  if (kind === "long" && (dir === "E" || dir === "W")) return combine(dir === "W", degs, mins, secs);
  return null;
}

function fromSuffixed(s: string, kind: "lat" | "long"): number | null {
  const [pos, neg] = kind === "lat" ? ["N", "S"] : ["E", "W"];
  let i = s.indexOf(pos);
  let negative = false;
  if (i < 0) {
    i = s.indexOf(neg);
    negative = true;
  }
  if (i < 0) return null;
  const head = s.slice(0, i);
  // Gramps prefixes S/W values with "-", so an already-signed one fails.
  if (negative && /^\s*[+-]/.test(head)) return null;
  const v = asFloat(head);
  return v == null ? null : negative ? -v : v;
}
