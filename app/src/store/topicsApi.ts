// Write/read path for Gramps Connect topics -- standalone Notes whose
// Note.type identifies them as "topic" (the channel/research-topic
// definition, JSON in text.string, same convention as storyBuilder.ts's
// StorySpec) or "topic-message" (one chat post, addressed via
// topicText.ts's line-1 handle encoding, same trick dmText.ts used for a
// DM's recipient). Same generic-object-CRUD, no-backend-changes shape as
// notesApi.ts/dmApi.ts -- a Topic replaces board messages, per-object
// messages, and DMs all at once (see the Topics plan).
import { API_BASE } from "../config";
import { fetchPage, PAGE_SIZE, parseErrorMessage } from "./api";
import { deleteObject } from "./objectsApi";
import { formatTopicMessageText, parseTopicMessageText, buildTopicMessageExpr } from "./topicText";
import { TOPICS_VIEW, TOPIC_MESSAGES_VIEW } from "./views";

export const TOPIC_TYPE = "topic";
export const TOPIC_MESSAGE_TYPE = "topic-message";

export interface TopicSpec {
  title: string;
  description?: string;
  /** Usernames invited to this topic when it was started (or added since
   * via EditTopicButton.tsx) -- descriptive, not an ACL: gramps-web-api's
   * permissions are role-global, not per-record (see the Topics plan), so
   * there's no way to actually restrict reading/posting to just this list
   * without a backend change. It's a "who this is for" label the UI shows
   * (FloatingTopicWindow.tsx, RelatedPanel.tsx's topic header), same
   * honesty about `private` already documented in createTopic below. */
  participants?: string[];
}

function addedHandle(trans: { type: string; handle: string }[]): string {
  const added = trans.find((t) => t.type === "add");
  if (!added) throw new Error("expected an 'add' transaction entry, got none");
  return added.handle;
}

/** Parses a topic Note's JSON text -- falls back to the raw (truncated)
 * text as the title on parse failure, same fallback views.ts's storyTitle()
 * uses for a story spec that isn't valid JSON (an older/foreign note that
 * happens to carry the "topic" type but isn't valid JSON shouldn't break
 * the row). */
export function parseTopicSpec(raw: string | null | undefined): TopicSpec {
  try {
    const spec = JSON.parse(raw ?? "") as TopicSpec;
    if (spec && typeof spec.title === "string") return spec;
  } catch {
    // fall through to the raw-text fallback below
  }
  const text = raw ?? "";
  return { title: text.length > 80 ? `${text.slice(0, 80)}…` : text || "Untitled discussion" };
}

/** Creates a standalone Note typed "topic" -- AddObject only, no PUT of
 * anything else. Always private, same as notesApi.ts's createMessage
 * (hidden from Guest role only, not a real per-recipient ACL). Builds the
 * spec by only setting keys that were actually given (rather than e.g.
 * `{title, description, participants}` with some left `undefined`) so
 * `title` stays the *only* key for a caller that gives neither -- what
 * openOrCreateUserTopic's own dedup fragment (`JSON.stringify({title})`)
 * assumes it can match exactly. */
export async function createTopic(token: string, title: string, description?: string, participants?: string[]): Promise<string> {
  const spec: TopicSpec = { title };
  if (description) spec.description = description;
  if (participants && participants.length > 0) spec.participants = participants;
  const res = await fetch(`${API_BASE}/api/notes/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: { string: JSON.stringify(spec) },
      type: TOPIC_TYPE,
      private: true,
    }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return addedHandle(await res.json());
}

/** Full replace of a topic's title/description/participants -- requires
 * EditObject, same as any other object edit (renaming/curating a topic is
 * a curation action, not the low-bar "post a message" one). */
export async function updateTopic(token: string, handle: string, spec: TopicSpec): Promise<void> {
  const getRes = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) throw new Error(await parseErrorMessage(getRes));
  const obj = await getRes.json();
  obj.text = { string: JSON.stringify(spec) };
  const putRes = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(obj),
  });
  if (!putRes.ok) throw new Error(await parseErrorMessage(putRes));
}

/** Creates a standalone Note typed "topic-message", addressed to
 * `topicHandle` on its text's own first line (topicText.ts's
 * formatTopicMessageText). AddObject only -- no attach/PUT step, unlike a
 * per-object comment under the old MessageButton.tsx: this is what lets
 * anyone who can create objects at all post in an existing topic, not just
 * whoever also holds EditObject. */
export async function postTopicMessage(token: string, topicHandle: string, author: string, message: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/notes/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: { string: formatTopicMessageText(topicHandle, author, message) },
      type: TOPIC_MESSAGE_TYPE,
      private: true,
    }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return addedHandle(await res.json());
}

/** Full replace of one message's own text -- author and topic addressing
 * are re-stamped exactly as given rather than read back off the existing
 * note first, so a caller (TopicThread.tsx) that already has both in hand
 * (it rendered this exact message) doesn't need an extra GET just to learn
 * what it already knows; only the message body itself actually changes.
 * Requires EditObject, same as any other object edit -- unlike posting a
 * new message (AddObject-only), editing an existing Note always has. */
export async function updateTopicMessage(
  token: string, handle: string, topicHandle: string, author: string, message: string
): Promise<void> {
  const getRes = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) throw new Error(await parseErrorMessage(getRes));
  const obj = await getRes.json();
  obj.text = { string: formatTopicMessageText(topicHandle, author, message) };
  const putRes = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(obj),
  });
  if (!putRes.ok) throw new Error(await parseErrorMessage(putRes));
}

export interface TopicChatMessage {
  handle: string;
  author: string;
  text: string;
  change?: number;
}

/** Every topic-message Note addressed to `topicHandle`, oldest first --
 * scoped server-side via topicText.ts's buildTopicMessageExpr, same ad hoc
 * fetchPage() shape dmApi.ts's fetchDmConversation already used (no
 * ViewStore/OPFS cache involved -- TOPIC_MESSAGES_VIEW is deliberately not
 * in views.ts's VIEWS array, same reasoning as the old DM_VIEW). */
export async function fetchTopicMessages(token: string, topicHandle: string, limit: number): Promise<TopicChatMessage[]> {
  const whereExpr = `${TOPIC_MESSAGES_VIEW.baseFilter} and (${buildTopicMessageExpr(topicHandle)})`;
  const { page } = await fetchPage(
    TOPIC_MESSAGES_VIEW, token, null, false, whereExpr,
    [{ column: "change", direction: "desc" }], limit
  );
  return page.items
    .map((item) => {
      const raw = (item.text as { string?: string } | string | null) ?? "";
      const text = typeof raw === "string" ? raw : (raw.string ?? "");
      const { author, message } = parseTopicMessageText(text);
      const change = typeof item.change === "number" ? item.change : undefined;
      return { handle: item.handle as string, author: author ?? "Unknown", text: message, change };
    })
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0));
}

/** Deletes every message addressed to `topicHandle` -- used by
 * DeleteButton.tsx before deleting the topic note itself, so a deleted
 * discussion doesn't leave its messages behind as orphaned private Notes
 * (each one addressed to `topicHandle` only by a handle embedded in its
 * own text, not a structural note_list reference -- gramps-web-api's
 * delete_note only cleans up note_list backlinks when a Note is deleted,
 * so nothing server-side ever does this on its own). Pages through the
 * full set in batches of PAGE_SIZE (the server's own max page size, see
 * api.ts) rather than a single capped fetch, so a discussion with more
 * messages than fit in one page still gets fully cleaned up, not just its
 * first PAGE_SIZE. Each batch's own handles are captured before any of
 * that batch is deleted, and `next_after` is a positional cursor rather
 * than a reference to a still-existing row, so deleting a batch doesn't
 * disturb the next page's own fetch. */
export async function deleteAllTopicMessages(token: string, topicHandle: string): Promise<void> {
  const whereExpr = `${TOPIC_MESSAGES_VIEW.baseFilter} and (${buildTopicMessageExpr(topicHandle)})`;
  let after: string | null = null;
  for (;;) {
    const { page } = await fetchPage(
      TOPIC_MESSAGES_VIEW, token, after, false, whereExpr, TOPIC_MESSAGES_VIEW.orderBy, PAGE_SIZE
    );
    if (page.items.length === 0) break;
    await Promise.all(page.items.map((item) => deleteObject(token, TOPIC_MESSAGES_VIEW, item.handle)));
    if (!page.next_after) break;
    after = page.next_after;
  }
}

/** Deletes one message -- TopicThread.tsx's own per-bubble delete control.
 * Thin wrapper (rather than TopicThread.tsx reaching into objectsApi.ts/
 * views.ts directly) so every topic-message operation stays reachable from
 * this one module. */
export async function deleteTopicMessage(token: string, handle: string): Promise<void> {
  await deleteObject(token, TOPIC_MESSAGES_VIEW, handle);
}

/** Escapes a fragment for embedding as a Python-style single-quoted GOQL
 * string literal -- same idea as dmText.ts's goqlSafe, but escaping rather
 * than stripping, since this fragment (a JSON substring built by this same
 * module) needs to match exactly, not just avoid breaking the query. */
function goqlLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Canonical title for the 1:1 topic between two users, sorted so either
 * party's click resolves to the same topic. */
function pairTitle(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${x} & ${y}`;
}

/** Finds the 1:1 topic between `me` and `peer` by its canonical title, or
 * creates one if none exists yet. Used by ActiveUsers.tsx's avatar click in
 * place of the old dmUi.ts/DmThread.tsx modal -- a 1:1 conversation is just
 * an ordinary, unlinked topic with a deterministic title, not a separate
 * kind of object. */
export async function openOrCreateUserTopic(token: string, me: string, peer: string): Promise<string> {
  const title = pairTitle(me, peer);
  // Matches the exact JSON substring createTopic() writes for a
  // description-less spec ({"title":"<title>"}) -- an exact substring test,
  // not like()'s wildcard-pattern match.
  const fragment = JSON.stringify({ title });
  const whereExpr = `${TOPICS_VIEW.baseFilter} and ('${goqlLiteral(fragment)}' in text.string)`;
  const { page } = await fetchPage(TOPICS_VIEW, token, null, false, whereExpr, TOPICS_VIEW.orderBy, 1);
  if (page.items.length > 0) return page.items[0].handle as string;
  return createTopic(token, title);
}
