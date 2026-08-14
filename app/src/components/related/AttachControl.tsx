import { useState } from "react";
import { Modal } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { attachRefListEntry } from "../../store/refListApi";
import { CircleGlyphButton } from "../CircleGlyphButton";
import { RecordPicker } from "../RecordPicker";
import type { QueryItem } from "../../store/api";
import type { ViewConfig } from "../../store/views";

/** A result's display label, built from the *query-list* shape fetchPage
 * actually returns (each pickerView's own flat `columns`, e.g. Citation's
 * "source_title" -- see views.ts) -- deliberately not summary.ts's
 * summaryLine(), which reads a record's *extended* detail shape
 * (`obj.extended?.source?.title`, only present on a RelatedPanel fetch).
 * Using summaryLine here silently fell through to a bare Gramps ID (or
 * "(citation)") for every result, since a QueryItem never has `.extended`
 * at all. Only ever called with one of the four picker views this file
 * uses (note/citation/tag/media), matching their exact column keys. */
function pickerResultLabel(type: string, item: QueryItem): string {
  switch (type) {
    case "note":
      return (item.text as string | undefined) || (item.gramps_id as string | undefined) || "(untitled)";
    case "citation": {
      const title = (item.source_title as string | undefined) ?? "";
      const page = (item.page as string | undefined) ?? "";
      return [title, page].filter(Boolean).join(", ") || (item.gramps_id as string | undefined) || "(untitled)";
    }
    case "tag":
      return (item.name as string | undefined) || "(untitled)";
    case "media":
      return (
        (item.desc as string | undefined) ||
        (item.path as string | undefined) ||
        (item.gramps_id as string | undefined) ||
        "(untitled)"
      );
    default:
      return (item.gramps_id as string | undefined) ?? item.handle;
  }
}

interface AttachControlProps {
  /** The currently-displayed record's own view -- attach PUTs back to
   * *this* object (via `targetHandle`), not the picked one. */
  targetView: ViewConfig;
  targetHandle: string;
  /** Which type's records this control searches -- NOTE_VIEW/CITATION_VIEW/
   * TAG_VIEW/MEDIA_VIEW. */
  pickerView: ViewConfig;
  /** e.g. "note_list"/"citation_list"/"tag_list"/"media_list". */
  listField: string;
  /** True only for media_list -- its entries are `{_class:"MediaRef",
   * ref}`, not a bare handle (RefBadges/objectDetail.ts's RawRef shape). */
  wrapRef?: boolean;
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
 * (refListApi.ts) and calls `onAttached` so the caller can refetch. Reused,
 * unmodified, by NotesSection/CitationsSection/TagsSection/MediaSection --
 * gating on EditObject and rendering nothing otherwise is this component's
 * own job, not each call site's, so a permission check can't be forgotten
 * at one of the four. */
export function AttachControl({
  targetView, targetHandle, pickerView, listField, wrapRef, itemLabel, onAttached,
}: AttachControlProps) {
  const [opened, setOpened] = useState(false);
  if (!hasPermissions("EditObject")) return null;

  async function handlePick(item: QueryItem) {
    setOpened(false);
    const token = await getToken();
    const entry = wrapRef ? { _class: "MediaRef", ref: item.handle } : item.handle;
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
