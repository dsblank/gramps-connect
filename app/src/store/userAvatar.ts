// Shared per-user avatar look (color + initials) -- gramps-web-api has no
// avatar/profile-image concept at all (see activeUsers.ts's doc comment),
// so this client-side derivation is the only per-user visual distinction
// available, and it's used both for UserMenu's own avatar and for
// ActiveUsers' avatars so the same person always looks the same everywhere.

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
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash << 5) - hash + username.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
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
