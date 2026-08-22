// "author: message" encoding for a Gramps Connect message's Note.text --
// see notesApi.ts's MESSAGE_TYPE doc comment for why this exists (Note
// has no author field).
// Split into its own module so views.ts (reads it for the "By"/"Message"
// columns' toDisplay) and notesApi.ts (writes it at creation) can both
// import it without notesApi.ts -> jobsApi.ts -> views.ts creating a cycle
// back through here.
const AUTHOR_SEPARATOR = ": ";

export function formatAuthoredText(author: string, message: string): string {
  return `${author}${AUTHOR_SEPARATOR}${message}`;
}

/** Splits "author: message" back apart for display. Falls back to
 * attributing the whole string to `message` with no author when it wasn't
 * written by createMessage (no separator found) rather than guessing --
 * covers a plain Note in the same tree that happens to get tagged
 * "message" by hand, or a pre-column-split legacy row. */
export function splitAuthorMessage(raw: string): { author: string | null; message: string } {
  const i = raw.indexOf(AUTHOR_SEPARATOR);
  if (i === -1) return { author: null, message: raw };
  return { author: raw.slice(0, i), message: raw.slice(i + AUTHOR_SEPARATOR.length) };
}
