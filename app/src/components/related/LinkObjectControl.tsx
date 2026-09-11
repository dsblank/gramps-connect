import { useState } from "react";
import { Alert, Modal, Select, Stack } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { attachRefListEntry } from "../../store/refListApi";
import { bumpTopicActivity } from "../../store/topicWindows";
import { pickerResultLabel } from "../RefPickerField";
import { RecordPicker } from "../RecordPicker";
import { CircleGlyphButton } from "../CircleGlyphButton";
import {
  CITATION_VIEW, EVENT_VIEW, FAMILY_VIEW, MEDIA_VIEW, NOTE_VIEW, PERSON_VIEW,
  PLACE_VIEW, REPOSITORY_VIEW, SOURCE_VIEW, type ViewConfig,
} from "../../store/views";
import type { QueryItem } from "../../store/api";
import { t } from "../../i18n/i18n";

// Every type that carries a note_list -- Tag is the one RELATED_CONFIG type
// with no "notes" section (gramps/gen/lib/tag.py has no note_list field at
// all), so linking a topic to a Tag would have nowhere to attach the
// reference; Story/Topics/generated are synthetic Note-under-a-filter
// views, not distinct object types worth linking a topic to.
const LINKABLE_VIEWS: ViewConfig[] = [
  PERSON_VIEW, FAMILY_VIEW, EVENT_VIEW, PLACE_VIEW, REPOSITORY_VIEW, SOURCE_VIEW, CITATION_VIEW, MEDIA_VIEW, NOTE_VIEW,
];

/** "+" control on a Topic's own page to link an existing record into it --
 * AttachControl.tsx's shape (a "+" trigger opening a Modal with a
 * RecordPicker), but with an extra type-selector step first: unlike every
 * AttachControl caller (which always searches one fixed type), a Topic can
 * link to *any* object type, so which ViewConfig to search is itself a
 * choice made in this dialog rather than baked into the call site. Picking
 * an item pushes this topic's own handle onto *that record's* note_list
 * (attachRefListEntry -- the same call DiscussButton.tsx makes for a single
 * object's own first link) -- a Topic note has no note_list of its own
 * (Note doesn't inherit NoteBase in gramps' own class hierarchy, so it
 * can't hold a forward ref list), so linking always attaches in this
 * direction; TopicLinksSection.tsx's own backlinks lookup is what shows the
 * result back on this page.
 *
 * Mounted from two independent places for the same discussion -- this
 * control on RelatedPanel's own management page, and again inside
 * FloatingTopicWindow.tsx's collapsible "Linked objects" section -- so
 * `onLinked` alone (each mounting's own local refetch) isn't enough to
 * keep the *other* one in sync. bumpTopicActivity() covers that: both
 * FloatingTopicWindow and RelatedPanel's own topics branch already
 * refetch on topicWindows.ts's shared activity counter (that's what makes
 * a live-synced remote change show up promptly too), so bumping it here
 * reaches whichever one didn't just do this attach itself. */
export function LinkObjectControl({ topicHandle, onLinked }: { topicHandle: string; onLinked: () => void }) {
  const [opened, setOpened] = useState(false);
  const [pickerView, setPickerView] = useState<ViewConfig>(PERSON_VIEW);
  const [error, setError] = useState<string | null>(null);
  if (!hasPermissions("EditObject")) return null;

  async function handlePick(item: QueryItem) {
    setError(null);
    try {
      const token = await getToken();
      await attachRefListEntry(token, pickerView, item.handle, "note_list", topicHandle);
      bumpTopicActivity();
      setOpened(false);
      onLinked();
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  return (
    <>
      <CircleGlyphButton
        glyph="+"
        label={t("Link an object to this discussion")}
        textLabel={t("Link an object")}
        onClick={() => setOpened(true)}
      />
      <Modal opened={opened} onClose={() => setOpened(false)} title={t("Link an object to this discussion")} size="sm">
        <Stack gap="sm">
          <Select
            label={t("Type")}
            data={LINKABLE_VIEWS.map((v) => ({ value: v.key, label: t(v.label) }))}
            value={pickerView.key}
            onChange={(value) => {
              const next = LINKABLE_VIEWS.find((v) => v.key === value);
              if (next) setPickerView(next);
            }}
            allowDeselect={false}
          />
          <RecordPicker
            key={pickerView.key}
            view={pickerView}
            searchField="gramps_id"
            placeholder={pickerView.simpleSearch?.placeholder ?? t("Search…")}
            buildExpr={pickerView.simpleSearch?.buildExpr}
            renderLabel={(item) => pickerResultLabel(pickerView.key, item)}
            onPick={handlePick}
            confirmWithButton
          />
          {error && <Alert color="red">{error}</Alert>}
        </Stack>
      </Modal>
    </>
  );
}
