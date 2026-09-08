// Write/read path for Gramps Connect direct messages -- standalone Notes
// (never attached to any object's note_list, same as a board ToDo) whose
// Note.type identifies them as "DirectMessage" (see views.ts's DM_VIEW doc
// comment for why it's spelled out rather than abbreviated, and why
// DM_VIEW itself is deliberately not in the VIEWS array). Addressed, not
// private in any server-enforced sense: any user who can view notes at all
// can still read one via the API, same non-guarantee notesApi.ts's board
// messages already have -- see notesApi.ts's createMessage doc comment for
// what `private: true` actually buys (hidden from Guest role only).
import { API_BASE } from "../config";
import { fetchPage, parseErrorMessage, type QueryItem } from "./api";
import { buildDmInvolvesExpr, buildDmPairExpr, formatDmText, parseDmText } from "./dmText";
import { DM_VIEW } from "./views";

export const DM_TYPE = "DirectMessage";

function addedHandle(trans: { type: string; handle: string }[]): string {
  const added = trans.find((t) => t.type === "add");
  if (!added) throw new Error("expected an 'add' transaction entry, got none");
  return added.handle;
}

/** Creates a standalone Note typed "DirectMessage", addressed to
 * `recipient` on its text's own first line (dmText.ts's formatDmText). No
 * tag_list -- a DM has no board-message open/done concept. */
export async function createDm(token: string, author: string, recipient: string, message: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/notes/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: { string: formatDmText(recipient, author, message) },
      type: DM_TYPE,
      private: true,
    }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return addedHandle(await res.json());
}

/** DirectMessage notes matching DM_VIEW's own baseFilter, AND-ed with
 * `extraFilter` if given, newest first -- same ad hoc fetchPage() shape
 * homeStats.ts's fetchMessageBoards already uses for MESSAGES_VIEW, no
 * ViewStore/OPFS cache involved. Low-level: fetchDmConversation()/
 * fetchMyDmPool() below are what callers actually want, each scoping
 * `extraFilter` server-side via dmText.ts's where_expr builders so a
 * caller isn't pulling every DM in the whole tree (every conversation,
 * every user) to find the handful of rows it actually needs -- that
 * doesn't scale as tree-wide DM volume grows past `limit`, since an
 * unrelated pair's chatter can crowd out older messages of the
 * conversation actually being displayed. */
export async function fetchDmPool(token: string, limit: number, extraFilter?: string): Promise<QueryItem[]> {
  const whereExpr = extraFilter ? `${DM_VIEW.baseFilter} and (${extraFilter})` : (DM_VIEW.baseFilter ?? null);
  const { page } = await fetchPage(
    DM_VIEW, token, null, false, whereExpr,
    [{ column: "change", direction: "desc" }], limit
  );
  return page.items;
}

/** Every DM between `me` and `peer`, either direction -- what
 * DmThread.tsx needs to render one conversation. Scoped server-side via
 * buildDmPairExpr, so `limit` is a budget for this conversation alone. */
export async function fetchDmConversation(token: string, me: string, peer: string, limit: number): Promise<QueryItem[]> {
  return fetchDmPool(token, limit, buildDmPairExpr(me, peer));
}

/** Every DM `me` is a party to, any partner -- what DmInbox.tsx needs to
 * list every conversation `me` is in. Scoped server-side via
 * buildDmInvolvesExpr, so `limit` is a budget for `me`'s own DM traffic,
 * not the whole tree's. groupDmConversations() below still does the
 * per-partner bucketing this doesn't attempt. */
export async function fetchMyDmPool(token: string, me: string, limit: number): Promise<QueryItem[]> {
  return fetchDmPool(token, limit, buildDmInvolvesExpr(me));
}

export interface DmMessage {
  author: string;
  text: string;
  change?: number;
}

/** Parses every pool row via dmText.ts's parseDmText, keeps only the ones
 * `me` is either side of, and buckets them by "the other party" -- oldest
 * first per bucket, the same order MessageButton.tsx already builds for
 * MessageComposer's `history` prop. A row with no resolvable author or
 * recipient (parseDmText's malformed-input fallback) is dropped rather than
 * guessed into some conversation. */
export function groupDmConversations(me: string, items: QueryItem[]): Map<string, DmMessage[]> {
  const byPartner = new Map<string, DmMessage[]>();
  for (const item of items) {
    const raw = (item.text as { string?: string } | string | null) ?? "";
    const text = typeof raw === "string" ? raw : (raw.string ?? "");
    const { recipient, author, message } = parseDmText(text);
    if (!author || !recipient) continue;
    let partner: string | null = null;
    if (author === me && recipient !== me) partner = recipient;
    else if (recipient === me && author !== me) partner = author;
    if (!partner) continue;

    const change = typeof item.change === "number" ? item.change : undefined;
    const list = byPartner.get(partner);
    const entry: DmMessage = { author, text: message, change };
    if (list) list.push(entry);
    else byPartner.set(partner, [entry]);
  }
  for (const list of byPartner.values()) list.sort((a, b) => (a.change ?? 0) - (b.change ?? 0));
  return byPartner;
}

// Bumped whenever a DM is sent or a live-sync poll notices an incoming one
// -- a mounted DmInbox/DmThread subscribes to refetch, same idea as
// activeUsers.ts's listener set (no timer of its own here, just a version
// counter for useSyncExternalStore).
let activityVersion = 0;
const activityListeners = new Set<() => void>();

export function bumpDmActivity(): void {
  activityVersion++;
  for (const listener of activityListeners) listener();
}

export function subscribeDmActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function getDmActivityVersion(): number {
  return activityVersion;
}
