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
  /** Ignored (and may be omitted) when `onPick` is given -- the default
   * pick behavior calls this after a successful attach; a custom `onPick`
   * is responsible for its own equivalent refetch call instead. */
  onAttached?: () => void;
  /** Overrides `pickerView.simpleSearch?.buildExpr` -- e.g.
   * MapOverlaysSection.tsx narrows MEDIA_VIEW's own picker down to just KML
   * files, which that view's default search expr has no notion of. */
  buildExpr?: (term: string) => string | null;
  /** Replaces the default "attachRefListEntry then onAttached" behavior for
   * a picked item -- e.g. MapOverlaysSection.tsx needs to no-op when the
   * picked item is already attached to this same target (a map overlay can
   * be on several places at once, but shouldn't end up with a duplicate ref
   * on the same one). Must trigger its own caller-side refetch when done,
   * same as the default path does via `onAttached`. */
  onPick?: (item: QueryItem) => void | Promise<void>;
  /** When given, the picker also offers a "+ Create new <createLabel>…"
   * bridge inline in its results (RecordPicker.tsx's own `onCreateNew`) --
   * for a type whose "attach an existing one" control should also let you
   * create a brand new one without leaving this same dialog, e.g.
   * MapOverlaysSection.tsx's "+ Add map overlay" offering both "pick an
   * existing overlay" and "draw a new one" behind one trigger. This
   * control's own Modal closes first, since the caller's creation flow
   * (typically a full editor) needs the screen to itself. Every existing
   * attach-only caller (Notes/Citations/Tags/Media/...) omits this, so the
   * "not finding it?" bridge simply never renders for them, same as today. */
  onCreateNew?: (query: string) => void;
  /** Paired with `onCreateNew` -- e.g. "map overlay". Ignored (and may be
   * omitted) without `onCreateNew`. */
  createLabel?: string;
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
 * (refListApi.ts) and calls `onAttached` so the caller can refetch -- or,
 * with `onPick`, does whatever that caller needs instead (MapOverlaysSection.tsx's
 * move-instead-of-duplicate logic). `buildExpr`/`onCreateNew`/`createLabel`
 * are the same standard "the record picker also offers a create-new bridge"
 * shape as ObjectEditDialog's own reference fields (see
 * RefPickerField.tsx's SearchOrCreate) -- collapsed here into the one
 * trigger this app's Related Pane conventions expect, rather than that
 * component's separate "Select existing…" / "+ New X" pair. Reused by every
 * list-ref section (Notes/Citations/Tags/Media/Children/Events/
 * Associations/Repositories/MapOverlaysSection) -- gating on EditObject and
 * rendering nothing otherwise is this component's own job, not each call
 * site's, so a permission check can't be forgotten at any of them. See
 * SetFieldControl below for the singular-ref-field counterpart. */
export function AttachControl({
  targetView, targetHandle, pickerView, listField, buildEntry, itemLabel, onAttached,
  buildExpr, onPick, onCreateNew, createLabel,
}: AttachControlProps) {
  const [opened, setOpened] = useState(false);
  if (!hasPermissions("EditObject")) return null;

  async function defaultPick(item: QueryItem) {
    const token = await getToken();
    const entry = buildEntry ? buildEntry(item.handle) : item.handle;
    await attachRefListEntry(token, targetView, targetHandle, listField, entry);
    onAttached?.();
  }

  async function handlePick(item: QueryItem) {
    setOpened(false);
    await (onPick ?? defaultPick)(item);
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
          buildExpr={buildExpr ?? pickerView.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel(pickerView.key, item)}
          onPick={handlePick}
          confirmWithButton
          createLabel={createLabel}
          onCreateNew={onCreateNew ? (query) => { setOpened(false); onCreateNew(query); } : undefined}
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
