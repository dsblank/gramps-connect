import { useState } from "react";
import { getToken, hasPermissions } from "../../../auth/auth";
import { detachRefListEntry } from "../../../store/refListApi";
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
        textLabel={addStoryLabel}
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
  const noteRows = rows.filter(({ target }) => !isTopic(target) && !isStory(target));
  const topicRows = rows.filter(({ target }) => isTopic(target));
  const storyRows = rows.filter(({ target }) => isStory(target));
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
    if (!window.confirm(`Remove ${summary} from this ${view.key}? This does not delete the ${englishKind} itself.`)) return;
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
      {topicRows.length > 0 && (
        <SectionShell label={t("Discussions")}>
          {topicRows.map(({ handle, target }) => (
            <RefRow
              key={handle}
              type="topics"
              handle={handle}
              obj={target}
              label={summaryLine("topics", target)}
              onNavigate={onNavigate}
              // Opens a FloatingTopicWindow instead of navigating/sub-
              // selecting -- a topic is a live conversation you want to
              // keep chatting in without losing this record off screen,
              // not a page to drill into.
              onClick={() => openTopicWindow(handle)}
              onRemove={canAttach ? () => handleRemove(handle, target, "topics") : undefined}
            />
          ))}
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
