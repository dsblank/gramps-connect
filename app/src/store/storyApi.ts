// Pilot write path for "story" notes -- a standalone Note tagged "story"
// whose text is a JSON-stringified StorySpec (storyBuilder.ts), attached to
// the person it was generated from via the normal note_list mechanism (same
// two-step create-then-attach as MessageButton.tsx). Same generic-object
// shape as notesApi.ts's createMessage; kept in its own module since a
// story note isn't a message and shouldn't show up in MessagesSection.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { getOrCreateTagHandle } from "./jobsApi";
import type { StorySpec } from "./storyBuilder";

export const STORY_TAG = "story";

function addedHandle(trans: { type: string; handle: string }[]): string {
  const added = trans.find((t) => t.type === "add");
  if (!added) throw new Error("expected an 'add' transaction entry, got none");
  return added.handle;
}

export async function createStoryNote(token: string, spec: StorySpec): Promise<string> {
  const storyTag = await getOrCreateTagHandle(token, STORY_TAG);
  const res = await fetch(`${API_BASE}/api/notes/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: { string: JSON.stringify(spec) }, tag_list: [storyTag] }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return addedHandle(await res.json());
}
