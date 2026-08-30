// Write path for "story" notes -- a standalone Note whose Note.type
// identifies it as "story" (a custom NoteType, set the same way
// notesApi.ts's MESSAGE_TYPE is -- see its doc comment) and whose text is a
// JSON-stringified StorySpec (storyBuilder.ts), attached to the person it
// was generated from via the normal note_list mechanism (same two-step
// create-then-attach as MessageButton.tsx). Same generic-object shape as
// notesApi.ts's createMessage; kept in its own module since a story note
// isn't a message and shouldn't show up in NotesSection's ordinary-Notes
// split.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { attachNoteToObject } from "./notesApi";
import type { ObjectDetail } from "./objectDetail";
import { getViewStore } from "./registry";
import { buildFamilyStory, buildPersonStory, type StorySpec } from "./storyBuilder";
import { loadVisualData } from "./visualData";
import type { ViewConfig } from "./views";

export const STORY_TYPE = "story";

function addedHandle(trans: { type: string; handle: string }[]): string {
  const added = trans.find((t) => t.type === "add");
  if (!added) throw new Error("expected an 'add' transaction entry, got none");
  return added.handle;
}

export async function createStoryNote(token: string, spec: StorySpec): Promise<string> {
  const res = await fetch(`${API_BASE}/api/notes/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: { string: JSON.stringify(spec) }, type: STORY_TYPE }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return addedHandle(await res.json());
}

/** Builds a fresh StorySpec from `detail`, writes it as a new story Note,
 * and attaches it -- the shared generate-and-attach logic behind
 * NotesSection.tsx's "+ Add a story" control (originally StoryButton.tsx's
 * handleClick, extracted here once that header button moved into the
 * Stories section so both a future caller and this one don't duplicate the
 * try/attach/requery sequence). Regenerates (and attaches a new note) on
 * every call rather than reusing a previous one -- still the simplest thing
 * that could work, per the pilot's original reasoning in StoryView.tsx's
 * history.
 *
 * Which seeding rule runs is decided by `view.key`, the same way every
 * other type-varying behavior in this app is; STORY_SOURCE_VIEWS below is
 * the matching list the UI gates on, so the two can't drift.
 * `subjectLabel` (a person's name; unused for a family, which names itself
 * from its own resolved parents) is passed in rather than computed here
 * because store/ modules stay free of that import direction -- see
 * draftStack.ts's SavedDraft doc comment for the same convention.
 *
 * Throws if there's nothing to build a story from (message meant for
 * direct display) -- callers don't need to separately check for a null
 * StorySpec. Calls getViewStore("story").requeryDebounced() so the new
 * note shows up in the Story sidebar listing immediately rather than
 * waiting for the next background poll tick (mirrors MessageComposer.tsx's
 * own requeryDebounced() after a message save). */
export async function generateStory(
  token: string,
  view: ViewConfig,
  detail: ObjectDetail,
  subjectLabel: string
): Promise<StorySpec> {
  const visualData = await loadVisualData();
  const built = view.key === "family"
    ? await buildFamilyStory(token, detail, visualData)
    : await buildPersonStory(token, detail, subjectLabel, visualData);
  if (!built) {
    throw new Error(view.key === "family"
      ? "This family has no events to build a story from -- not on the family itself, and no births or deaths recorded for its members."
      : "This person has no events to build a story from.");
  }
  const noteHandle = await createStoryNote(token, built);
  await attachNoteToObject(token, view, detail.handle, noteHandle);
  getViewStore("story").requeryDebounced();
  return built;
}

/** The view keys generateStory knows a seeding rule for -- what
 * NotesSection.tsx's "+ Add a story" gates on, so adding a rule above is
 * the only place a new story source has to be declared. */
export const STORY_SOURCE_VIEWS = new Set(["person", "family"]);
