// "<topic_handle>\n<author>: <message>" encoding for a topic chat post's
// Note.text -- same line-1-addressing trick dmText.ts used for a DM's
// recipient, just addressing a topic handle instead of a username. The
// author/message half reuses authoredText.ts's own "author: message"
// convention unchanged.
import { AUTHOR_SEPARATOR, formatAuthoredText, splitAuthorMessage } from "./authoredText";

export function formatTopicMessageText(topicHandle: string, author: string, message: string): string {
  return `${topicHandle}\n${formatAuthoredText(author, message)}`;
}

/** Splits "<topic_handle>\n<author>: <message>" back apart. `topicHandle` is
 * null when the first line doesn't look like one (no "\n" at all) -- same
 * "don't guess" fallback splitAuthorMessage already uses for a missing
 * author. */
export function parseTopicMessageText(raw: string): { topicHandle: string | null; author: string | null; message: string } {
  const nl = raw.indexOf("\n");
  if (nl === -1) return { topicHandle: null, ...splitAuthorMessage(raw) };
  const topicHandle = raw.slice(0, nl);
  const rest = raw.slice(nl + 1);
  return { topicHandle, ...splitAuthorMessage(rest) };
}

/** where_expr fragment matching only topic-message notes addressed to
 * `topicHandle` -- AND this with a topic-message type filter
 * (TOPIC_MESSAGES_VIEW.baseFilter) before sending; this fragment alone
 * doesn't restrict to topic-message notes. An exact substring test (`'...'
 * in text.string`), not like()'s wildcard-pattern match -- a handle is an
 * opaque generated id, but this stays consistent with dmText.ts's
 * buildDmPairExpr regardless. */
export function buildTopicMessageExpr(topicHandle: string): string {
  return `'${topicHandle}\\n' in text.string`;
}
