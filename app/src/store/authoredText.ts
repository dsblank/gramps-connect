// "author: message" encoding for a chat post's Note.text -- Note has no
// author field of its own. Used by topicText.ts's line-1-addressed topic
// messages (and, historically, board messages/DMs, both since removed in
// favor of Topics).
export const AUTHOR_SEPARATOR = ": ";

export function formatAuthoredText(author: string, message: string): string {
  return `${author}${AUTHOR_SEPARATOR}${message}`;
}

/** Splits "author: message" back apart for display. Falls back to
 * attributing the whole string to `message` with no author when it wasn't
 * written by one of this encoding's writers (no separator found) rather
 * than guessing -- covers a plain Note in the same tree that happens to get
 * typed "topic-message" by hand, or a pre-column-split legacy row. */
export function splitAuthorMessage(raw: string): { author: string | null; message: string } {
  const i = raw.indexOf(AUTHOR_SEPARATOR);
  if (i === -1) return { author: null, message: raw };
  return { author: raw.slice(0, i), message: raw.slice(i + AUTHOR_SEPARATOR.length) };
}
