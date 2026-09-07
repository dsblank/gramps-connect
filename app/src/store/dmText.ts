// "to:<recipient>\n<author>: <message>" encoding for a direct message's
// Note.text -- see dmApi.ts's DM_TYPE doc comment for why a DM's recipient
// lives here instead of a Tag. The author/message half reuses
// authoredText.ts's own "author: message" convention (and its no-guessing
// fallback) unchanged; this just adds one more line in front of it.
import { formatAuthoredText, splitAuthorMessage } from "./authoredText";

const RECIPIENT_PREFIX = "to:";

export function formatDmText(recipient: string, author: string, message: string): string {
  return `${RECIPIENT_PREFIX}${recipient}\n${formatAuthoredText(author, message)}`;
}

/** Splits "to:<recipient>\n<author>: <message>" back apart. `recipient` is
 * null when the first line isn't a "to:" header -- a plain Note that
 * happens to get typed "DirectMessage" by hand, or a pre-this-format
 * legacy row -- same "don't guess" fallback splitAuthorMessage already
 * uses for a missing author. */
export function parseDmText(raw: string): { recipient: string | null; author: string | null; message: string } {
  const nl = raw.indexOf("\n");
  const firstLine = nl === -1 ? raw : raw.slice(0, nl);
  if (!firstLine.startsWith(RECIPIENT_PREFIX)) {
    return { recipient: null, ...splitAuthorMessage(raw) };
  }
  const recipient = firstLine.slice(RECIPIENT_PREFIX.length);
  const rest = nl === -1 ? "" : raw.slice(nl + 1);
  return { recipient, ...splitAuthorMessage(rest) };
}
