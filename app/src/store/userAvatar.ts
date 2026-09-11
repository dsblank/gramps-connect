// Shared per-user avatar look (color + initials) -- gramps-web-api has no
// avatar/profile-image concept at all (see activeUsers.ts's doc comment),
// so this client-side derivation is the only per-user visual distinction
// available, and it's used both for UserMenu's own avatar and for
// ActiveUsers' avatars so the same person always looks the same everywhere.

/** Deterministic 0-359 hue for `username`, shared by colorForUsername below
 * and ChatBubble.tsx's bubble backgrounds -- the one hash both derive
 * from, so "this user's color" means the same thing everywhere instead of
 * each caller hashing its own way and landing on unrelated colors for the
 * same person. */
function hueForUsername(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash << 5) - hash + username.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

/** Stable per-username color, hashed purely client-side. Not cryptographic,
 * just needs to be deterministic and spread across the wheel so different
 * users are visually distinct.
 *
 * Pass this to Mantine's `<Avatar color={...} variant="filled">`, not to a
 * `style={{ backgroundColor: ... }}` override -- the placeholder letters
 * render in a nested `<span>` whose text color comes from a CSS var Mantine
 * derives from `color`/`variant` (see @mantine/core's defaultVariantColorsResolver,
 * the "filled" branch), so an inline style on the Avatar root changes the
 * background but never reaches that span's color, leaving Mantine's default
 * gray placeholder text (low contrast on every background, and the bug this
 * comment is here to prevent a repeat of). */
export function colorForUsername(username: string): string {
  return `hsl(${hueForUsername(username)}, 55%, 45%)`;
}

/** Mantine's named palette (excluding the two greyscale entries, "dark"/
 * "gray"), each with its actual approximate hue at the shade Mantine's
 * default theme centers on -- open-color-derived, e.g. red #fa5252 (~4°),
 * yellow #fab005 (~42°), lime #82c91e (~82°), cyan #22b8cf (~189°), grape
 * #be4bdb (~288°). NOT evenly spaced around the wheel (yellow-to-lime is a
 * ~40° gap, lime-to-green another ~48°), so bubbleColorForUsername below
 * has to search this table for the closest actual hue rather than divide
 * 360° into twelve equal slices -- an equal-slice version snapped a hue as
 * far as ~35° away from its true nearest color (e.g. 86° landed in an
 * evenly-spaced "yellow" slice despite sitting right next to lime's real
 * 82°), which is what made a user's own bubble color visibly not match
 * their Avatar's raw hue while others happened to land closer by luck. */
const NAMED_COLOR_HUES: { name: string; hue: number }[] = [
  { name: "red", hue: 4 },
  { name: "orange", hue: 25 },
  { name: "yellow", hue: 42 },
  { name: "lime", hue: 82 },
  { name: "green", hue: 130 },
  { name: "teal", hue: 162 },
  { name: "cyan", hue: 189 },
  { name: "blue", hue: 205 },
  { name: "indigo", hue: 228 },
  { name: "violet", hue: 256 },
  { name: "grape", hue: 288 },
  { name: "pink", hue: 336 },
];

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/** Same per-user hue as colorForUsername, snapped to the nearest Mantine
 * theme color name -- unlike colorForUsername's raw hsl() (fine for an
 * Avatar's solid `color` prop), ChatBubble.tsx's chat bubbles use
 * Mantine's `--mantine-color-<name>-light` CSS variable for their
 * background so it stays theme-aware (a paler tint in light mode, a
 * desaturated dark tint in dark mode) -- that variable only exists for
 * named theme colors, not an arbitrary hue, so this is the closest named
 * match (by actual hue distance, see NAMED_COLOR_HUES) rather than the
 * continuous value itself. */
export function bubbleColorForUsername(username: string): string {
  const hue = hueForUsername(username);
  let closest = NAMED_COLOR_HUES[0];
  let closestDistance = circularHueDistance(hue, closest.hue);
  for (const candidate of NAMED_COLOR_HUES.slice(1)) {
    const distance = circularHueDistance(hue, candidate.hue);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest.name;
}

/** Two-letter initials: first letter of the first and last word of `name`
 * ("Demo Editor" -> "DE"; also works unresolved, splitting a raw username
 * on the separators usernames actually use, "demo-editor" -> "DE"), or the
 * first two characters when there's only one word ("gramps" -> "GR"). A
 * single letter reads poorly at avatar size, especially in the light theme. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}
