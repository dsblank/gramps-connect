import { Button, Group, Title } from "@mantine/core";
import { hasPermissions } from "../auth/auth";
import { DRAFT_TYPE_LABELS, EDITABLE_TYPES, type DraftType, type UseDraftStack } from "../store/draftStack";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";
import { MessageComposer } from "./MessageComposer";

const PERM_ADD_OBJ = "AddObject";
const PERM_EDIT_OBJ = "EditObject";

/** "a Person"/"an Event" -- matches MenuBar.tsx's own un-translated
 * `New ${DRAFT_TYPE_LABELS[type]}…` interpolation, since these singular
 * names aren't Gramps desktop msgids either. */
function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

/** Row above FilterBar's search box, spanning just the list panel (App.tsx
 * mounts this inside the same Box as FilterBar/DataTable, not the aside) --
 * the view's plural label on the left (e.g. "People", "Places"), an
 * "Add a Person"/"Add an Event" button on the right (singular DraftType
 * label, withArticle() above) that opens the same stacked create dialog as
 * MenuBar's "Add" menu (draftStack.ts).
 *
 * "story" is excluded the same way MenuBar.tsx excludes it from its own Add
 * dropdown: a blank story has no person to attach to, only the person-scoped
 * generate flow creates one. Media/Output have no create dialog at all (not
 * in EDITABLE_TYPES), so they get the title with no button. Messages isn't a
 * DraftType at all -- its "Add a ToDo" is MessageComposer's own modal, wired
 * in via renderTrigger the same way MessageButton.tsx gets its icon
 * trigger, just styled to match every other view's button (this used to be
 * App.tsx's own standalone "+ New message" row). Labeled "ToDo" rather than
 * "Message" because a message created with no target object never becomes
 * part of a conversation (see MessageButton's own history prop) -- it's a
 * standalone task, which is exactly what Home's ToDo panel now surfaces it
 * as (homeStats.ts's fetchMessageBoards). */
export function ListHeader({ view, draftStack }: { view: ViewConfig; draftStack: UseDraftStack }) {
  const type = view.key as DraftType;
  const canAdd =
    type !== "story" &&
    EDITABLE_TYPES.includes(type) &&
    hasPermissions(...(type === "family" ? [PERM_ADD_OBJ, PERM_EDIT_OBJ] : [PERM_ADD_OBJ]));

  return (
    <Group justify="space-between" mb="sm" wrap="nowrap">
      <Title order={4}>{t(view.label)}</Title>
      {view.key === "messages" && hasPermissions(PERM_ADD_OBJ) && (
        <MessageComposer renderTrigger={(open) => (
          <Button size="xs" onClick={open}>Add {withArticle("ToDo")}</Button>
        )} />
      )}
      {canAdd && (
        <Button size="xs" onClick={() => draftStack.openDraft(type)}>
          Add {withArticle(DRAFT_TYPE_LABELS[type])}
        </Button>
      )}
    </Group>
  );
}
