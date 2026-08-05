import { SectionShell, RefRow, zipHandles } from "./shared";
import type { SectionProps } from "../types";

/** NoteBase.note_list -- a plain handle list, present on nearly every type. */
export function NotesSection({ detail, onNavigate }: SectionProps) {
  const rows = zipHandles(detail.note_list, detail.extended?.notes);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Notes" count={rows.length} defaultOpen>
      {rows.map(({ handle, target }) => (
        <RefRow key={handle} type="note" handle={handle} obj={target} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
