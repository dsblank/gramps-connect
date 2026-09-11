// Generic Note helpers shared across features that attach a Note to an
// arbitrary object's note_list (DiscussButton.tsx's per-object topic link,
// LinkObjectControl.tsx's topic-to-record link) or need to inspect a
// live-synced Note's own type before deciding how to react to it
// (App.tsx's onRemoteNoteChange). Board messages/DMs, which used to live
// here, are gone -- see topicsApi.ts, which replaces both with Topics.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { attachRefListEntry } from "./refListApi";
import type { ViewConfig } from "./views";

/** Appends `noteHandle` to an arbitrary object's `note_list` -- the
 * structural way a Note "references" another object in Gramps' own data
 * model (NotesSection.tsx already renders whatever's in it for every type
 * that has one). Thin wrapper around refListApi.ts's generic
 * attachRefListEntry, kept here since call sites read more clearly naming
 * "note" than a generic "note_list" string literal. */
export async function attachNoteToObject(
  token: string,
  view: ViewConfig,
  objectHandle: string,
  noteHandle: string
): Promise<void> {
  await attachRefListEntry(token, view, objectHandle, "note_list", noteHandle);
}

/** Plain GET of one Note, no `extend`/`backlinks` -- just its own fields
 * (type, text.string, private, ...). Used by App.tsx's onRemoteNoteChange
 * to tell a live-synced note's type apart (topic, topic-message, story, or
 * a plain note) before deciding how to notify. */
export async function fetchNoteRaw(token: string, handle: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}
