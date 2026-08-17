import { Anchor, Modal } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { DRAFT_TYPE_LABELS, type SavedDraft, type UseDraftStack } from "../store/draftStack";
import { formatHash } from "../hash";
import { summaryLine } from "./related/summary";
import { PersonEditDialog } from "./PersonEditDialog";
import { FamilyEditDialog } from "./FamilyEditDialog";
import { ObjectEditDialog } from "./ObjectEditDialog";

/** Toast per object saveAll() actually saved -- a link (via formatHash,
 * same in-app hash nav as HomeView's own Anchor rows) straight to that
 * object on its view, so "I just added/edited X" has somewhere to go
 * without hunting for it in the table. Fired here rather than inside
 * draftStack.ts itself: summaryLine's label-building code lives under
 * components/, and store/ doesn't reach up into components/ (see
 * SavedDraft's doc comment). */
function announceSaved(saved: SavedDraft[]) {
  for (const entry of saved) {
    const verb = entry.mode === "new" ? "added" : "updated";
    notifications.show({
      color: entry.mode === "new" ? "green" : "blue",
      title: `${DRAFT_TYPE_LABELS[entry.type]} ${verb}`,
      message: (
        <Anchor component="a" href={formatHash({ viewKey: entry.type, handle: entry.handle })} underline="never">
          {summaryLine(entry.type, entry.data)}
        </Anchor>
      ),
    });
  }
}

interface EditDialogsProps {
  draftStack: UseDraftStack;
}

/** Renders every draft opened this session (draftStack.stack) as a Modal
 * inside a Mantine Modal.Stack, so a "New Family" dialog and any "New
 * Person" dialogs it spawned can all be open -- and independently
 * clickable to the front -- at once. A draft's own `mode`/`status`
 * (draftStack.ts) decide what each dialog renders (New vs. Edit title,
 * loading/error state) -- this component just wires callbacks through.
 *
 * Renders unconditionally over the whole stack, not just the open ones
 * (openHandles only controls each Modal's `opened` prop): Mantine's
 * ModalStack registers/unregisters a stackId purely through Modal's own
 * `[opened, stackId, zIndex]` effect, which has no unmount cleanup. Actually
 * removing a hidden dialog's element from the tree (as an earlier version
 * of this component did) leaves its id stuck in ModalStack's internal
 * `stack` forever, so nothing else could ever become `currentId` again --
 * every remaining modal in the app render permanently hidden. Toggling
 * `opened` on an always-mounted Modal is the only safe way to hide one.
 *
 * Owns no state itself: MenuBar.tsx calls useDraftStack() and passes the
 * result down, the same "state lives with whoever mounts the dialog"
 * convention every other dialog here follows. */
export function EditDialogs({ draftStack }: EditDialogsProps) {
  const {
    stack, openHandles, openDraft, openEditDraft, showDraft, hideDraft, updateDraft, setExtraObjects, closeDraft,
    saveAll, saving, error,
  } = draftStack;

  async function handleSaveAll() {
    announceSaved(await saveAll());
  }

  return (
    <Modal.Stack>
      {stack.map((draft) => {
        const { handle } = draft;
        const opened = openHandles.includes(handle);
        const isTopLevel = !draft.openedFrom;
        const primaryLabel = isTopLevel ? "Save" : "Done";
        const onPrimary = isTopLevel ? handleSaveAll : () => hideDraft(handle);

        if (draft.type === "person") {
          return (
            <PersonEditDialog
              key={handle}
              draft={draft}
              opened={opened}
              onChange={(patch) => updateDraft(handle, patch)}
              onSetExtraObjects={(extra) => setExtraObjects(handle, extra)}
              onCancel={() => closeDraft(handle)}
              primaryLabel={primaryLabel}
              onPrimary={onPrimary}
              saving={isTopLevel && saving}
              error={isTopLevel ? error : null}
            />
          );
        }
        if (draft.type === "family") {
          return (
            <FamilyEditDialog
              key={handle}
              draft={draft}
              opened={opened}
              stack={stack}
              openHandles={openHandles}
              onChange={(patch) => updateDraft(handle, patch)}
              onOpenPersonDraft={(field) => openDraft("person", { handle, field })}
              onShowDraft={showDraft}
              onCloseDraft={closeDraft}
              onCancel={() => closeDraft(handle)}
              primaryLabel={primaryLabel}
              onPrimary={onPrimary}
              saving={isTopLevel && saving}
              error={isTopLevel ? error : null}
            />
          );
        }
        return (
          <ObjectEditDialog
            key={handle}
            draft={draft}
            opened={opened}
            stack={stack}
            openHandles={openHandles}
            onChange={(patch) => updateDraft(handle, patch)}
            onOpenDraft={(type, field) => openDraft(type, { handle, field })}
            onOpenEditDraft={(type, targetHandle, field) => openEditDraft(type, targetHandle, { handle, field })}
            onShowDraft={showDraft}
            onCloseDraft={closeDraft}
            onCancel={() => closeDraft(handle)}
            primaryLabel={primaryLabel}
            onPrimary={onPrimary}
            saving={isTopLevel && saving}
            error={isTopLevel ? error : null}
          />
        );
      })}
    </Modal.Stack>
  );
}
