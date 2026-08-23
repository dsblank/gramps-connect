import { Text, Tooltip, UnstyledButton } from "@mantine/core";
import { hasPermissions } from "../../auth/auth";
import { EDITABLE_TYPES, type DraftType, type UseDraftStack } from "../../store/draftStack";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";

/** Top-right icon on a RelatedPanel (next to MessageButton, in the same
 * "act on the record itself" header slot) that opens this object in the
 * stacked edit-dialog flow (PersonEditDialog.tsx/FamilyEditDialog.tsx/
 * ObjectEditDialog.tsx via draftStack.ts's openEditDraft) -- the same
 * dialogs the "Add" menu's New Person/New Family/... already use, just
 * pre-filled instead of blank.
 *
 * Only offered for a type with an edit dialog (EDITABLE_TYPES --
 * everything except Media, which wraps an uploaded file rather than a
 * blank form, and the synthetic Output/Messages views), and only to a
 * user who actually holds EditObject (what the PUT this eventually
 * triggers requires server-side, base.py's GrampsObjectProtectedResource.put).
 *
 * A plain text glyph rather than an SVG icon (unlike MessageButton's) --
 * no "edit" icon exists in Gramps' own icon set to copy
 * (assets/icons/ATTRIBUTION.md's convention for the rest of this
 * directory), and this codebase already renders lightweight UI glyphs as
 * plain text elsewhere (DataTable's sort arrows, AsideSplit's ▾/▴) rather
 * than adding a new icon dependency for one button. */
export function EditButton({
  view, detail, draftStack,
}: {
  view: ViewConfig;
  detail: ObjectDetail;
  draftStack: UseDraftStack;
}) {
  const eligible = EDITABLE_TYPES.includes(view.key as DraftType);
  if (!eligible || !hasPermissions("EditObject")) return null;

  const label = `Edit this ${view.key}`;

  return (
    <Tooltip label={label} withArrow>
      <UnstyledButton
        onClick={() => draftStack.openEditDraft(view.key as DraftType, detail.handle)}
        aria-label={label}
        p={6}
        style={{ borderRadius: "50%" }}
      >
        <Text fz={22} lh={1}>✎</Text>
      </UnstyledButton>
    </Tooltip>
  );
}
