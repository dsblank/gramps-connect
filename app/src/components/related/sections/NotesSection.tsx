import { useState } from "react";
import { getToken, hasPermissions } from "../../../auth/auth";
import { confirmDialog } from "../../../store/confirmDialog";
import { notifications } from "@mantine/notifications";
import { detachRefListEntry, moveRefListEntry } from "../../../store/refListApi";
import { SortableList, useOptimisticOrder } from "../../SortableList";
import { generateStory, STORY_SOURCE_VIEWS, STORY_TYPE } from "../../../store/storyApi";
import type { StoryOptions, StorySpec } from "../../../store/storyBuilder";
import { TOPIC_TYPE } from "../../../store/topicsApi";
import { openTopicWindow } from "../../../store/topicWindows";
import { NOTE_VIEW } from "../../../store/views";
import { StoryView } from "../../StoryView";
import { AttachControl } from "../AttachControl";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { StoryOptionsDialog } from "../StoryOptionsDialog";
import { summaryLine } from "../summary";
import { SectionShell, RefRow, zipHandles } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

interface RawNote {
  tag_list?: string[];
  // gramps-web-api flattens Note.type to a plain string in its REST JSON
  // responses ("story", "topic", or a standard type's name like "General")
  // rather than the {_class, value, string} shape the query endpoint's
  // json_data uses internally (see views.ts's TOPICS_VIEW/STORY_VIEW
  // baseFilter, which target .string against that internal shape instead)
  // -- confirmed by fetching a person with extend=all and inspecting
  // extended.notes.
  type?: string;
  text?: { string?: string };
}

/** "+ Add a story" -- the Stories section's own generate-and-attach
 * trigger, replacing the old header-icon StoryButton.tsx (now deleted).
 * Offered on the types storyApi.ts has a seeding rule for
 * (STORY_SOURCE_VIEWS: a person's own events, or a family's events merged
 * with its members' births and deaths), with the same permission gate the
 * header icon used to have. A click opens StoryOptionsDialog.tsx first
 * rather than generating straight away -- its own Generate then runs the
 * same immediate-presentation behavior the old header button had, just one
 * step later. */
function AddStoryControl({ view, detail, onAttached }: { view: SectionProps["view"]; detail: SectionProps["detail"]; onAttached: () => void }) {
  const [spec, setSpec] = useState<StorySpec | null>(null);
  const [opened, setOpened] = useState(false);
  const [dialogOpened, setDialogOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!STORY_SOURCE_VIEWS.has(view.key) || !hasPermissions("AddObject", "EditObject")) return null;

  // Named after which seeding rule this view uses (STORY_SOURCE_VIEWS is
  // just "person"/"family" today), so the button and StoryOptionsDialog.tsx's
  // title say which kind of story a click builds rather than the generic
  // "Add a story".
  const addStoryLabel = view.key === "family" ? t("Add a family's story") : t("Add a person's story");

  async function handleGenerate(options: StoryOptions) {
    setBusy(true);
    setError(null);
    try {
      // Only the person rule uses this -- a family story names itself from
      // its own resolved father/mother (storyBuilder.ts's buildFamilyStory).
      const personName = summaryLine("person", detail) || "this person";
      const token = await getToken();
      const built = await generateStory(token, view, detail, personName, options);
      onAttached();
      setSpec(built);
      setDialogOpened(false);
      setOpened(true);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CircleGlyphButton
        glyph="+"
        label={addStoryLabel}
        onClick={() => {
          setError(null);
          setDialogOpened(true);
        }}
      />
      <StoryOptionsDialog
        opened={dialogOpened}
        title={addStoryLabel}
        view={view}
        detail={detail}
        busy={busy}
        error={error}
        onClose={() => setDialogOpened(false)}
        onGenerate={handleGenerate}
      />
      <StoryView spec={spec} opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}

/** NoteBase.note_list -- a plain handle list, present on nearly every type.
 * A listed note might itself be a linked Topic (DiscussButton.tsx/
 * LinkObjectControl.tsx attach a topic note's handle here rather than
 * putting any reference in the topic's own text) or a story rather than an
 * ordinary Note -- told apart by `target.type`, an embedded field on each
 * resolved Note that needs no further lookup (see RawNote's own doc comment
 * for the string-vs-object shape gotcha). Split into separate SectionShells
 * (mirrors Notes/Topics/Stories already being separate top-level sidebar
 * views) rather than one mixed list; topic rows route through onNavigate as
 * "topics" rather than "note" -- otherwise a click lands on the general
 * Notes view instead of that Topic's own chat page. */
export function NotesSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipHandles<RawNote>(detail.note_list, detail.extended?.notes);
  const isTopic = (target: RawNote) => target?.type === TOPIC_TYPE;
  const isStory = (target: RawNote) => target?.type === STORY_TYPE;
  // Each sub-list is reordered on its own, shown in its new order straight
  // after a drop until the refetch catches up (as in ChildrenSection).
  const noteOrder = useOptimisticOrder(rows.filter(({ target }) => !isTopic(target) && !isStory(target)), detail);
  const topicOrder = useOptimisticOrder(rows.filter(({ target }) => isTopic(target)), detail);
  const storyOrder = useOptimisticOrder(rows.filter(({ target }) => isStory(target)), detail);
  const noteRows = noteOrder.rows;
  const topicRows = topicOrder.rows;
  const storyRows = storyOrder.rows;
  const [moving, setMoving] = useState(false);
  // "+ Add a story" only offered where there's a seeding rule -- same
  // reasoning AddStoryControl's own internal gate has, kept here too so the
  // Stories SectionShell itself doesn't render empty for every other type.
  const canAddStory = STORY_SOURCE_VIEWS.has(view.key) && hasPermissions("AddObject", "EditObject");
  // Every editable type's own edit dialog also has a Notes field
  // (PersonEditDialog.tsx/FamilyEditDialog.tsx/ObjectEditDialog.tsx's
  // "refList" field kind) -- this live attach/detach is a quicker path to
  // the same note_list, not the only one, so no type is excluded here.
  const canAttach = hasPermissions("EditObject");

  // Shared by every row below -- a story or topic is still just a note_list
  // entry (a tagged/typed Note), so unlinking it is the exact same
  // detachRefListEntry call, just with `kind` swapped in so the confirm
  // copy reads as "story"/"topic"/its own title rather than "note"/raw note
  // text. `kind` doubles as summaryLine's own type key, hence "topics" (not
  // the singular English word used in the confirm copy itself).
  async function handleRemove(handle: string, target: RawNote, kind: "note" | "story" | "topics") {
    const summary = summaryLine(kind, target) || `this ${kind}`;
    const englishKind = kind === "topics" ? "discussion" : kind;
    if (!(await confirmDialog(`Remove ${summary} from this ${view.key}? This does not delete the ${englishKind} itself.`))) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "note_list", handle);
    onRefetch?.();
  }

  // A drop within one sub-list moves that note to where the note it was
  // dropped on sits in the record's whole note_list (notes, discussions and
  // stories share it), so the other sub-lists keep their places. One PUT,
  // so one undoable change in the record's History.
  async function handleMove(order: typeof noteOrder, from: number, to: number) {
    if (moving) return;
    const noteList = (detail.note_list as string[] | undefined) ?? [];
    const handle = order.rows[from].handle;
    const fullFrom = noteList.indexOf(handle);
    const fullTo = noteList.indexOf(order.rows[to].handle);
    order.move(from, to);
    setMoving(true);
    try {
      const token = await getToken();
      await moveRefListEntry(token, view, detail.handle, "note_list", fullFrom, fullTo, handle);
      onRefetch?.();
    } catch (err) {
      order.revert();
      notifications.show({
        color: "red",
        title: t("Couldn't change the order of the notes"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMoving(false);
    }
  }

  return (
    <>
      {(noteRows.length > 0 || canAttach) && (
        <SectionShell
          label={t("Notes")}
          action={canAttach && (
            <AttachControl
              targetView={view}
              targetHandle={detail.handle}
              pickerView={NOTE_VIEW}
              listField="note_list"
              itemLabel="a note"
              createType="note"
              onAttached={() => onRefetch?.()}
            />
          )}
        >
          <SortableList
            keys={noteRows.map((r) => r.handle)}
            onMove={(from, to) => handleMove(noteOrder, from, to)}
            disabled={!canAttach}
            gap="var(--mantine-spacing-sm)"
            renderItem={(i, grip) => {
              const { handle, target } = noteRows[i];
              return (
                <RefRow
                  type="note"
                  handle={handle}
                  obj={target}
                  grip={grip}
                  onNavigate={onNavigate}
                  onRemove={canAttach ? () => handleRemove(handle, target, "note") : undefined}
                />
              );
            }}
          />
        </SectionShell>
      )}
      {topicRows.length > 0 && (
        <SectionShell label={t("Discussions")}>
          <SortableList
            keys={topicRows.map((r) => r.handle)}
            onMove={(from, to) => handleMove(topicOrder, from, to)}
            disabled={!canAttach}
            gap="var(--mantine-spacing-sm)"
            renderItem={(i, grip) => {
              const { handle, target } = topicRows[i];
              return (
                <RefRow
                  type="topics"
                  handle={handle}
                  obj={target}
                  label={summaryLine("topics", target)}
                  grip={grip}
                  onNavigate={onNavigate}
                  // Opens a FloatingTopicWindow instead of navigating/sub-
                  // selecting -- a topic is a live conversation you want to
                  // keep chatting in without losing this record off screen,
                  // not a page to drill into.
                  onClick={() => openTopicWindow(handle)}
                  onRemove={canAttach ? () => handleRemove(handle, target, "topics") : undefined}
                />
              );
            }}
          />
        </SectionShell>
      )}
      {(storyRows.length > 0 || canAddStory) && (
        <SectionShell
          label={t("Stories")}
          action={canAddStory && (
            <AddStoryControl view={view} detail={detail} onAttached={() => onRefetch?.()} />
          )}
        >
          <SortableList
            keys={storyRows.map((r) => r.handle)}
            onMove={(from, to) => handleMove(storyOrder, from, to)}
            disabled={!canAttach}
            gap="var(--mantine-spacing-sm)"
            renderItem={(i, grip) => {
              const { handle, target } = storyRows[i];
              return (
                <RefRow
                  type="story"
                  handle={handle}
                  obj={target}
                  label={summaryLine("story", target)}
                  grip={grip}
                  onNavigate={onNavigate}
                  onRemove={canAttach ? () => handleRemove(handle, target, "story") : undefined}
                />
              );
            }}
          />
        </SectionShell>
      )}
    </>
  );
}
