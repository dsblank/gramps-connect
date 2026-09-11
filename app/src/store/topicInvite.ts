// Decides whether a live-synced Note change is a Topic naming the
// signed-in user as a participant for the first time -- pulled out of
// App.tsx's own onRemoteNoteChange as a pure function so it's unit-testable
// without pulling in App.tsx's whole import graph (AppShell, MenuBar, ...).
import { parseTopicSpec, TOPIC_TYPE } from "./topicsApi";

export type NoteChangeClassification =
  | { kind: "generic" }
  | { kind: "invite"; title: string };

/** `note` is a plain GET response (notesApi.ts's fetchNoteRaw) -- `type`
 * and `text` each arrive as either a bare string or a `{string: ...}`
 * wrapper depending on which route resolved it (the same inconsistency
 * NotesSection.tsx's own RawNote doc comment documents for a different
 * endpoint), so both are unwrapped defensively rather than assuming one
 * shape. `alreadyNotified` is the caller's own per-handle dedup (App.tsx's
 * notifiedInviteHandles) -- this function makes no assumption about *why*
 * a handle might already be marked, just honors it, so a topic you're
 * already known to be on doesn't re-announce itself on every later edit,
 * only the first time you're found on its participants list does. */
export function classifyRemoteNoteChange(
  note: Record<string, unknown>,
  me: string | null,
  alreadyNotified: boolean
): NoteChangeClassification {
  const type = (note.type as { string?: string } | string | null) ?? null;
  const typeString = typeof type === "string" ? type : type?.string;
  if (typeString !== TOPIC_TYPE) return { kind: "generic" };

  const rawText = (note.text as { string?: string } | string | null) ?? "";
  const text = typeof rawText === "string" ? rawText : (rawText.string ?? "");
  const spec = parseTopicSpec(text);

  if (me && !alreadyNotified && (spec.participants ?? []).includes(me)) {
    return { kind: "invite", title: spec.title };
  }
  return { kind: "generic" };
}
