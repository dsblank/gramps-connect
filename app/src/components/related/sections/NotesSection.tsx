import { useEffect, useState } from "react";
import { getToken } from "../../../auth/auth";
import { getTagHandleCached, TEAM_NOTE_TAG, TODO_DONE_TAG } from "../../../store/notesApi";
import { summaryLine } from "../summary";
import { SectionShell, RefRow, zipHandles } from "./shared";
import type { SectionProps } from "../types";

interface RawNote {
  tag_list?: string[];
}

/** The "team-note" and "todo-done" tags' own handles (resolved once,
 * cached -- see getTagHandleCached's doc comment), needed to tell which of
 * a note's raw tag_list entries mean anything. Both start `null` before the
 * lookups resolve, so a message briefly renders as a plain, non-done note
 * on first paint rather than blocking the whole section on two network
 * round trips. */
function useKnownTagHandles(): { teamNote: string | null; done: string | null } {
  const [teamNote, setTeamNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const [teamNoteHandle, doneHandle] = await Promise.all([
          getTagHandleCached(token, TEAM_NOTE_TAG),
          getTagHandleCached(token, TODO_DONE_TAG),
        ]);
        if (!cancelled) {
          setTeamNote(teamNoteHandle);
          setDone(doneHandle);
        }
      } catch {
        // Not fatal -- rows just render/navigate as plain notes until this
        // resolves (both tags always exist once any message has ever been
        // created, so this only matters on a transient failure).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { teamNote, done };
}

/** NoteBase.note_list -- a plain handle list, present on nearly every type.
 * A listed note might itself be a Gramps Connect message (MessageButton.tsx
 * attaches new messages here rather than putting any reference in the
 * message text) rather than an ordinary Note -- extend=all only resolves
 * names for the *top-level* fetched object's own forward refs, not a
 * second level deep, so a nested note's `tag_list` here is still raw
 * handles. Split into two SectionShells (mirrors Notes/Messages already
 * being separate top-level sidebar views) rather than one mixed list;
 * message rows route through onNavigate as "team_note" rather than "note"
 * -- otherwise a click lands on the general Notes view instead of Messages
 * and loses TeamNoteActions (Mark done/Reopen/Delete) -- and get a "done"
 * indicator ordinary notes have no equivalent of. */
export function NotesSection({ detail, onNavigate }: SectionProps) {
  const { teamNote: teamNoteTag, done: doneTag } = useKnownTagHandles();

  const rows = zipHandles<RawNote>(detail.note_list, detail.extended?.notes);
  const isMessage = (target: RawNote) => Boolean(teamNoteTag && target?.tag_list?.includes(teamNoteTag));
  const noteRows = rows.filter(({ target }) => !isMessage(target));
  const messageRows = rows.filter(({ target }) => isMessage(target));

  return (
    <>
      {noteRows.length > 0 && (
        <SectionShell label="Notes" count={noteRows.length} defaultOpen>
          {noteRows.map(({ handle, target }) => (
            <RefRow key={handle} type="note" handle={handle} obj={target} onNavigate={onNavigate} />
          ))}
        </SectionShell>
      )}
      {messageRows.length > 0 && (
        <SectionShell label="Messages" count={messageRows.length} defaultOpen>
          {messageRows.map(({ handle, target }) => {
            const isDone = Boolean(doneTag && target.tag_list?.includes(doneTag));
            const label = `${isDone ? "✓ " : ""}${summaryLine("team_note", target)}`;
            return <RefRow key={handle} type="team_note" handle={handle} obj={target} label={label} onNavigate={onNavigate} />;
          })}
        </SectionShell>
      )}
    </>
  );
}
