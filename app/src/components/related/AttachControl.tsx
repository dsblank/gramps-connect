import { useState } from "react";
import { Modal } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { attachRefListEntry, setRefField, type RefListEntry } from "../../store/refListApi";
import { CircleGlyphButton } from "../CircleGlyphButton";
import { RecordPicker } from "../RecordPicker";
import { pickerResultLabel } from "../RefPickerField";
import type { QueryItem } from "../../store/api";
import type { ViewConfig } from "../../store/views";

interface AttachControlProps {
  /** The currently-displayed record's own view -- attach PUTs back to
   * *this* object (via `targetHandle`), not the picked one. */
  targetView: ViewConfig;
  targetHandle: string;
  /** Which type's records this control searches -- NOTE_VIEW/CITATION_VIEW/
   * TAG_VIEW/MEDIA_VIEW/PERSON_VIEW/EVENT_VIEW/REPOSITORY_VIEW. */
  pickerView: ViewConfig;
  /** e.g. "note_list"/"citation_list"/"tag_list"/"media_list"/
   * "child_ref_list"/"event_ref_list"/"person_ref_list"/"reporef_list". */
  listField: string;
  /** Builds the entry appended to `listField` from the picked handle --
   * omit for a plain handle list (note_list/citation_list/tag_list); for a
   * *Ref-struct list, wrap it with sensible metadata defaults, e.g.
   * `(h) => ({_class: "MediaRef", ref: h})` or `(h) => ({_class:
   * "ChildRef", ref: h, frel: "Birth", mrel: "Birth"})` -- the section's
   * own RefEditDialog (if it has one) is the fix-up path for anything
   * other than the default. */
  buildEntry?: (handle: string) => RefListEntry;
  /** e.g. "a note" / "a citation" / "a tag" / "media" -- builds both the
   * trigger's tooltip ("Attach a note") and the dialog's own heading
   * ("Adding a note"). */
  itemLabel: string;
  onAttached: () => void;
}

/** A small circled "+" trigger (CircleGlyphButton.tsx) that opens a proper
 * dialog (Modal, not a Popover) titled "Adding <itemLabel>", with a
 * RecordPicker search box inside scoped to `pickerView`'s own tuned
 * simpleSearch -- the exact same buildExpr *and* placeholder copy
 * FilterBar's plain-text search mode already uses for that type (views.ts's
 * NOTE_VIEW/CITATION_VIEW/TAG_VIEW/MEDIA_VIEW all define one), so this
 * search behaves and reads identically to the search box on that type's own
 * list view. A plain Modal rather than a Popover: nesting a result list
 * inside a Popover's own floating/portal + outside-click-to-close handling
 * made picking a result unreliable (a click on a portaled option could
 * register as "outside the Popover" and close it before the pick
 * registered) -- a Modal has none of that ambiguity.
 *
 * Picking an item appends it to the displayed record's own `listField`
 * (refListApi.ts) and calls `onAttached` so the caller can refetch. Reused
 * by every list-ref section (Notes/Citations/Tags/Media/Children/Events/
 * Associations/Repositories) -- gating on EditObject and rendering nothing
 * otherwise is this component's own job, not each call site's, so a
 * permission check can't be forgotten at any of them. See SetFieldControl
 * below for the singular-ref-field counterpart. */
export function AttachControl({
  targetView, targetHandle, pickerView, listField, buildEntry, itemLabel, onAttached,
}: AttachControlProps) {
  const [opened, setOpened] = useState(false);
  if (!hasPermissions("EditObject")) return null;

  async function handlePick(item: QueryItem) {
    setOpened(false);
    const token = await getToken();
    const entry = buildEntry ? buildEntry(item.handle) : item.handle;
    await attachRefListEntry(token, targetView, targetHandle, listField, entry);
    onAttached();
  }

  return (
    <>
      <CircleGlyphButton
        glyph="+"
        label={`Attach ${itemLabel}`}
        textLabel={`Add ${itemLabel}`}
        onClick={() => setOpened(true)}
      />
      <Modal opened={opened} onClose={() => setOpened(false)} title={`Adding ${itemLabel}`} size="sm">
        <RecordPicker
          view={pickerView}
          searchField="gramps_id"
          placeholder={pickerView.simpleSearch?.placeholder ?? "Search…"}
          buildExpr={pickerView.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel(pickerView.key, item)}
          onPick={handlePick}
          confirmWithButton
        />
      </Modal>
    </>
  );
}

interface SetFieldControlProps {
  /** The currently-displayed record's own view -- set PUTs back to *this*
   * object (via `targetHandle`), not the picked one. */
  targetView: ViewConfig;
  targetHandle: string;
  /** Which type's records this control searches -- PERSON_VIEW/PLACE_VIEW/
   * SOURCE_VIEW. */
  pickerView: ViewConfig;
  /** e.g. "father_handle"/"mother_handle"/"place"/"source_handle" -- a
   * *singular* ref field, overwritten wholesale (not appended to, unlike
   * AttachControl's listField). */
  field: string;
  /** e.g. "a father" / "a place" / "a source" -- builds both the trigger's
   * tooltip and the dialog's own heading, same convention as
   * AttachControl's itemLabel. */
  itemLabel: string;
  onSet: () => void;
}

/** AttachControl's counterpart for a *singular* ref field (Family's
 * father_handle/mother_handle, Event's place, Citation's source_handle)
 * instead of a list -- same "+" trigger -> Modal -> RecordPicker shape, but
 * picking an item calls setRefField (refListApi.ts) to overwrite the whole
 * field rather than attachRefListEntry's append. Only ever rendered for an
 * *empty* slot -- an occupied one shows a plain RefRow (with its own "−" to
 * clear, where the field isn't required) instead of this control, same as
 * every list section shows existing rows above its own AttachControl. */
export function SetFieldControl({
  targetView, targetHandle, pickerView, field, itemLabel, onSet,
}: SetFieldControlProps) {
  const [opened, setOpened] = useState(false);
  if (!hasPermissions("EditObject")) return null;

  async function handlePick(item: QueryItem) {
    setOpened(false);
    const token = await getToken();
    await setRefField(token, targetView, targetHandle, field, item.handle);
    onSet();
  }

  return (
    <>
      <CircleGlyphButton
        glyph="+"
        label={`Set ${itemLabel}`}
        textLabel={`Add ${itemLabel}`}
        onClick={() => setOpened(true)}
      />
      <Modal opened={opened} onClose={() => setOpened(false)} title={`Setting ${itemLabel}`} size="sm">
        <RecordPicker
          view={pickerView}
          searchField="gramps_id"
          placeholder={pickerView.simpleSearch?.placeholder ?? "Search…"}
          buildExpr={pickerView.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel(pickerView.key, item)}
          onPick={handlePick}
          confirmWithButton
        />
      </Modal>
    </>
  );
}
