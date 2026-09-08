// "to:<recipient>\n<author>: <message>" encoding for a direct message's
// Note.text -- see dmApi.ts's DM_TYPE doc comment for why a DM's recipient
// lives here instead of a Tag. The author/message half reuses
// authoredText.ts's own "author: message" convention (and its no-guessing
// fallback) unchanged; this just adds one more line in front of it.
import { AUTHOR_SEPARATOR, formatAuthoredText, splitAuthorMessage } from "./authoredText";

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

/** Strips quote/backslash characters rather than escaping them, same
 * approach personSearch.ts's buildPersonSearchExpr uses -- a where_expr is
 * parsed source text, not a value to sanitize/bind. Needed here because a
 * DM recipient can be freely typed (DmInbox.tsx's "message a user" field
 * has no known-username constraint), not just a real, already-validated
 * username. */
function goqlSafe(s: string): string {
  return s.replace(/['\\]/g, "");
}

/** A single formatDmText() prefix, as a GOQL string literal -- an exact
 * substring test (`'...' in text.string`), not like()'s wildcard-pattern
 * match, so a name containing a LIKE-special character (`_` is a common
 * one -- "bot_test" -- and would otherwise match as a single-char
 * wildcard) can't cause a false match either way. `\n` is deliberately the
 * two characters backslash+n here, not a real newline -- this string is
 * GOQL/Python source the server parses, and a raw embedded newline isn't
 * valid inside a single-quoted Python string literal, while `\n` in that
 * source parses to the same real newline formatDmText() actually wrote. */
function dmPrefixLiteral(recipient: string, author: string): string {
  return `'${RECIPIENT_PREFIX}${recipient}\\n${author}${AUTHOR_SEPARATOR}' in text.string`;
}

/** where_expr fragment matching only DM notes between `a` and `b`, either
 * direction -- AND this with a DirectMessage type filter (DM_VIEW.baseFilter)
 * before sending; this fragment alone doesn't restrict to DirectMessage
 * notes. Lets a conversation be fetched directly instead of pulling every
 * DM in the tree and filtering client-side (see dmApi.ts's
 * fetchDmConversation, the caller). */
export function buildDmPairExpr(a: string, b: string): string {
  const [x, y] = [goqlSafe(a), goqlSafe(b)];
  return `(${dmPrefixLiteral(y, x)}) or (${dmPrefixLiteral(x, y)})`;
}

/** where_expr fragment matching any DM `me` is a party to, as author or
 * recipient, with any partner -- narrower than the whole tree's DM pool
 * (see dmApi.ts's fetchMyDmPool, the caller) but not scoped to one
 * conversation the way buildDmPairExpr is; DmInbox.tsx needs every
 * partner's latest message, not just one. A message whose free-form body
 * happens to itself contain a look-alike "\n<name>: " substring can still
 * over-match here (the message text isn't excluded from the search the
 * way the structured prefix is) -- harmless, since groupDmConversations()
 * re-parses and re-buckets every row it's handed and drops anything that
 * doesn't actually resolve to `me` as author or recipient; the cost is
 * just an occasional wasted row against `limit`'s budget, not a wrong
 * result. */
export function buildDmInvolvesExpr(me: string): string {
  const m = goqlSafe(me);
  const toMe = `'${RECIPIENT_PREFIX}${m}\\n' in text.string`;
  const fromMe = `'\\n${m}${AUTHOR_SEPARATOR}' in text.string`;
  return `(${toMe}) or (${fromMe})`;
}
