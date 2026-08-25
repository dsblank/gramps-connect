import { Button } from "@mantine/core";
import { hasPermissions } from "../../auth/auth";
import { EDITABLE_TYPES, type DraftType, type UseDraftStack } from "../../store/draftStack";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";
import { t } from "../../i18n/i18n";

/** Top-right button on a RelatedPanel (next to MessageButton, in the same
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
 * A labeled secondary button rather than an icon -- the previous plain-text
 * ✎ glyph read as too small/minor for what is actually a primary action on
 * the record. */
export function EditButton({
  view, detail, draftStack,
}: {
  view: ViewConfig;
  detail: ObjectDetail;
  draftStack: UseDraftStack;
}) {
  const eligible = EDITABLE_TYPES.includes(view.key as DraftType);
  if (!eligible || !hasPermissions("EditObject")) return null;

  return (
    <Button
      variant="default"
      size="xs"
      onClick={() => draftStack.openEditDraft(view.key as DraftType, detail.handle)}
      aria-label={`Edit this ${view.key}`}
    >
      {t("Edit")}
    </Button>
  );
}
