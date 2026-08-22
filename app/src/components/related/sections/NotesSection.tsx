import { useEffect, useState } from "react";
import { Alert, Text, UnstyledButton } from "@mantine/core";
import { getToken, hasPermissions } from "../../../auth/auth";
import { getTagHandleCached, MESSAGE_TYPE, TODO_DONE_TAG } from "../../../store/notesApi";
import { detachRefListEntry } from "../../../store/refListApi";
import { generatePersonStory, STORY_TYPE } from "../../../store/storyApi";
import type { StorySpec } from "../../../store/storyBuilder";
import { NOTE_VIEW } from "../../../store/views";
import { StoryView } from "../../StoryView";
import { AttachControl } from "../AttachControl";
import { summaryLine } from "../summary";
import { SectionShell, RefRow, zipHandles } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

interface RawNote {
  tag_list?: string[];
  // gramps-web-api flattens Note.type to a plain string in its REST JSON
  // responses ("story", or a standard type's name like "General") rather
  // than the {_class, value, string} shape the query endpoint's json_data
  // uses internally (see views.ts's MESSAGES_VIEW/STORY_VIEW baseFilter,
  // which target .string against that internal shape instead) -- confirmed
  // by fetching a person with extend=all and inspecting extended.notes.
  type?: string;
}

/** The "todo-done" tag's own handle (resolved once, cached -- see
 * getTagHandleCached's doc comment), needed to tell a done message from an
 * open one: a note's raw tag_list entries are unresolved handles (extend=all
 * doesn't resolve tag names on a note nested inside another object's
 * note_list), so there's nothing to compare against until this resolves.
 * Message/story identity has no such lookup -- Note.type is an embedded
 * field, read straight off `target.type.string` below. Starts `null` before
 * the lookup resolves, so a message briefly renders without its done
 * indicator on first paint rather than blocking the whole section on a
 * network round trip. */
function useDoneTagHandle(): string | null {
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const doneHandle = await getTagHandleCached(token, TODO_DONE_TAG);
        if (!cancelled) setDone(doneHandle);
      } catch {
        // Not fatal -- rows just render without a done indicator until this
        // resolves (the tag always exists once any message has ever been
        // marked done, so this only matters on a transient failure).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return done;
}

/** "+ Add a story" -- the Stories section's own generate-and-attach
 * trigger, replacing the old header-icon StoryButton.tsx (now deleted).
 * Person-only (storyBuilder.ts's buildPersonStory only knows how to read a
 * Person's own events), same permission gate the header icon used to have.
 * Preserves that button's own behavior of opening the presentation
 * immediately once the note's written, rather than requiring a second
 * click into the new row. */
function AddStoryControl({ view, detail, onAttached }: { view: SectionProps["view"]; detail: SectionProps["detail"]; onAttached: () => void }) {
  const [spec, setSpec] = useState<StorySpec | null>(null);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (view.key !== "person" || !hasPermissions("AddObject", "EditObject")) return null;

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const personName = summaryLine("person", detail) || "this person";
      const token = await getToken();
      const built = await generatePersonStory(token, view, detail, personName);
      onAttached();
      setSpec(built);
      setOpened(true);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <UnstyledButton onClick={handleClick} disabled={busy}>
        <Text size="sm" c="blue">{t("+ Add a story")}</Text>
      </UnstyledButton>
      {error && <Alert color="red">{error}</Alert>}
      <StoryView spec={spec} opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}

/** NoteBase.note_list -- a plain handle list, present on nearly every type.
 * A listed note might itself be a Gramps Connect message (MessageButton.tsx
 * attaches new messages here rather than putting any reference in the
 * message text) or a story rather than an ordinary Note -- told apart by
 * `target.type`, an embedded field on each resolved Note that needs no
 * further lookup (see RawNote's own doc comment for the string-vs-object
 * shape gotcha). Its `tag_list` is a different story: extend=all only
 * resolves names for the *top-level* fetched object's own forward refs, not
 * a second level deep, so a nested note's tag_list here is still raw
 * handles -- which is why the "done" indicator needs useDoneTagHandle's
 * resolved handle to compare against. Split into two SectionShells (mirrors
 * Notes/Messages already being separate top-level sidebar views) rather
 * than one mixed list; message rows route through onNavigate as "messages"
 * rather than "note" -- otherwise a click lands on the general Notes view
 * instead of Messages and loses MessageActions (Mark done/Reopen/Delete) --
 * and get a "done" indicator ordinary notes have no equivalent of. */
export function NotesSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const doneTag = useDoneTagHandle();

  const rows = zipHandles<RawNote>(detail.note_list, detail.extended?.notes);
  const isMessage = (target: RawNote) => target?.type === MESSAGE_TYPE;
  const isStory = (target: RawNote) => target?.type === STORY_TYPE;
  const noteRows = rows.filter(({ target }) => !isMessage(target) && !isStory(target));
  const messageRows = rows.filter(({ target }) => isMessage(target));
  const storyRows = rows.filter(({ target }) => isStory(target));
  // "+ Add a story" only offered on a person's own panel -- same reasoning
  // AddStoryControl's own internal gate has, kept here too so the Stories
  // SectionShell itself doesn't render empty for every other type.
  const canAddStory = view.key === "person" && hasPermissions("AddObject", "EditObject");
  // Every editable type's own edit dialog also has a Notes field
  // (PersonEditDialog.tsx/FamilyEditDialog.tsx/ObjectEditDialog.tsx's
  // "refList" field kind) -- this live attach/detach is a quicker path to
  // the same note_list, not the only one, so no type is excluded here.
  const canAttach = hasPermissions("EditObject");

  // Shared by both Notes and Stories rows below -- a story is still just a
  // note_list entry (a tagged Note), so unlinking it is the exact same
  // detachRefListEntry call, just with `kind` swapped in so the confirm
  // copy reads as "story"/its own title rather than "note"/raw note text.
  async function handleRemove(handle: string, target: RawNote, kind: "note" | "story") {
    const summary = summaryLine(kind, target) || `this ${kind}`;
    if (!window.confirm(`Remove ${summary} from this ${view.key}? This does not delete the ${kind} itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "note_list", handle);
    onRefetch?.();
  }

  return (
    <>
      {(noteRows.length > 0 || canAttach) && (
        <SectionShell label={t("Notes")}>
          {noteRows.map(({ handle, target }) => (
            <RefRow
              key={handle}
              type="note"
              handle={handle}
              obj={target}
              onNavigate={onNavigate}
              onRemove={canAttach ? () => handleRemove(handle, target, "note") : undefined}
            />
          ))}
          {canAttach && (
            <AttachControl
              targetView={view}
              targetHandle={detail.handle}
              pickerView={NOTE_VIEW}
              listField="note_list"
              itemLabel="a note"
              onAttached={() => onRefetch?.()}
            />
          )}
        </SectionShell>
      )}
      {messageRows.length > 0 && (
        <SectionShell label={t("Messages")}>
          {messageRows.map(({ handle, target }) => {
            const isDone = Boolean(doneTag && target.tag_list?.includes(doneTag));
            const label = `${isDone ? "✓ " : ""}${summaryLine("messages", target)}`;
            return <RefRow key={handle} type="messages" handle={handle} obj={target} label={label} onNavigate={onNavigate} />;
          })}
        </SectionShell>
      )}
      {(storyRows.length > 0 || canAddStory) && (
        <SectionShell label={t("Stories")}>
          {storyRows.map(({ handle, target }) => (
            <RefRow
              key={handle}
              type="story"
              handle={handle}
              obj={target}
              label={summaryLine("story", target)}
              onNavigate={onNavigate}
              onRemove={canAttach ? () => handleRemove(handle, target, "story") : undefined}
            />
          ))}
          {canAddStory && (
            <AddStoryControl view={view} detail={detail} onAttached={() => onRefetch?.()} />
          )}
        </SectionShell>
      )}
    </>
  );
}
