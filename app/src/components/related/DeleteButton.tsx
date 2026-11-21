import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { deleteObject } from "../../store/objectsApi";
import { reconnectPlaceChildren } from "../../store/placeReconnect";
import { deleteAllTopicMessages } from "../../store/topicsApi";
import { deleteNote, findJobReportNotes } from "../../store/jobsApi";
import { closeTopicWindow } from "../../store/topicWindows";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";
import { summaryLine } from "./summary";
import { t } from "../../i18n/i18n";

/** Top-right button on a RelatedPanel (in the same header action slot as
 * EditButton/DiscussButton) that deletes this record, after confirmation.
 * A labeled secondary button rather than an icon, same reasoning as
 * EditButton.tsx.
 *
 * Otherwise a plain single-object delete, nothing more: gramps-web-api has
 * no general "clean up now-orphaned linked items" capability to lean on
 * (the one maintenance endpoint, POST /api/trees/<id>/check/, only fixes
 * broken backlink bookkeeping and removes literally-empty records -- not
 * orphan cleanup), and computing that client-side was deliberately left
 * out, with no plans to add it. What the server *does* do on delete
 * (delete.py's per-type delete_person/delete_event/delete_citation/...):
 * strip the deleted
 * handle out of every *other* object that referenced it, so nothing is
 * left pointing at a handle that no longer exists -- and, where a
 * reference is *required* rather than optional (a Citation's
 * source_handle), cascade-delete the dependent object too instead of
 * leaving it invalid (delete_source, delete.py:412-497 -- confirmed live:
 * deleting a Source that a Citation pointed at deletes the Citation as
 * well, not just its reference). The confirmation copy below reflects
 * this.
 *
 * A Discussion is the one deliberate exception to "plain single-object
 * delete": its messages are each their own Note, addressed only by a
 * handle embedded in their own text (topicText.ts), not a note_list
 * reference -- so the server's own delete_note cleanup (which only
 * follows note_list backlinks) would never find them, leaving every one
 * behind as a permanently unreachable orphaned private Note. handleDelete
 * below runs topicsApi.ts's deleteAllTopicMessages first to actually clean
 * these up, confirmed by name in the dialog's own copy.
 *
 * Output ("generated") rows get it too: GeneratedItemActions.tsx's
 * "Don't save" prompt only appears right after a Download, so without this
 * there was no way to delete an Output item you hadn't just downloaded.
 * Like that prompt, it also deletes the export's own report Note(s).
 * Any user holding DeleteObject gets it (including Discussions -- a
 * Topic has no done/open concept the way the old board messages did, so
 * there's nothing bespoke here for it to duplicate) -- unlike EditButton,
 * there's no EDITABLE_TYPES restriction, since every real object type is
 * deletable even where a create/edit dialog doesn't exist for it (e.g.
 * Media).
 *
 * No draftStack needed (unlike EditButton) -- deleting doesn't open a
 * dialog, so this works in both RelatedPanel's top-pane mount and
 * ReferenceDetail's bottom-pane one without any prop threading. */
export function DeleteButton({ view, detail }: { view: ViewConfig; detail: ObjectDetail }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions("DeleteObject")) return null;

  // Every other view.key already reads as a singular noun ("person",
  // "event", ... "story"); "topics" is the one plural key (it doubles as
  // the URL segment and sidebar label's basis), so it's the one exception
  // worth spelling out here rather than baking a whole singularization
  // table into this generic button for just one caller.
  const singularKind = view.key === "topics" ? "discussion" : view.key === "generated" ? "output" : view.key;
  const label = `Delete this ${singularKind}`;
  const summary = summaryLine(view.key, detail) || view.label;

  function openConfirm() {
    setError(null);
    setConfirmOpen(true);
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const token = await getToken();
      if (view.key === "place") {
        // Not something the server does on its own (delete_place strips
        // this place from Person/Family/Event references, but never looks
        // at other *Places* -- see placeReconnect.ts's own doc comment):
        // run it first, so a child place that had this one as its
        // enclosing place is repointed at this place's own parent instead
        // of being left with a dangling reference once it's gone.
        await reconnectPlaceChildren(token, [detail.handle]);
      }
      if (view.key === "topics") {
        // Also not something the server does on its own: each message is
        // its own Note, addressed to this discussion only by a handle
        // embedded in its own text (topicText.ts), not a structural
        // note_list reference -- delete_note's own cleanup only follows
        // note_list backlinks, so it would never find these, and every one
        // would be left behind as a permanently unreachable orphaned
        // private Note (topicsApi.ts's deleteAllTopicMessages doc comment).
        // Run before deleting the discussion note itself, not after --
        // once it's gone, nothing could find these messages to delete them
        // by either.
        await deleteAllTopicMessages(token, detail.handle);
      }
      // An export's report Note (jobsPromote.ts's promoteJob) is about this
      // file only, and Gramps never cascades a Media delete to its notes --
      // same cleanup as GeneratedItemActions.tsx's "Don't save". Looked up
      // before the delete, while note_list still points at it.
      const reportNotes =
        view.key === "generated"
          ? await findJobReportNotes(token, (detail.note_list as string[] | undefined) ?? [])
          : [];
      await deleteObject(token, view, detail.handle);
      for (const note of reportNotes) {
        // Best-effort: the item itself is already gone.
        await deleteNote(token, note).catch((err) => console.error(`report note ${note} delete failed`, err));
      }
      if (view.key === "topics") {
        // A discussion's own floating window (topicWindows.ts) is a
        // separate, independent mounting from this button's own panel --
        // deleting the underlying note here doesn't make it go away on its
        // own (confirmed live: it stayed open, showing a record that no
        // longer exists), so this has to close it explicitly, the same way
        // EditTopicButton.tsx/LinkObjectControl.tsx/TopicLinksSection.tsx
        // already have to reach across to keep one in sync rather than
        // just refreshing.
        closeTopicWindow(detail.handle);
      }
      // Immediate feedback rather than waiting on historyPoll's next tick
      // (same reasoning as draftStack.ts's saveAll) -- ViewStore's own
      // reconcileSelection() then handles "the selected row is gone" the
      // same way it already does for a live-sync delete notification.
      getViewStore(view.key).requeryDebounced();
      setConfirmOpen(false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={openConfirm} aria-label={label}>
        {t("Delete")}
      </Button>
      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Delete this ${singularKind}?`}>
        <Stack gap="md">
          <Text size="sm">
            This permanently deletes <b>{summary}</b>. Every other reference to it is cleaned up
            automatically -- but a record that <i>{t("requires")}</i> this one (e.g. a Citation's Source) is
            deleted right along with it, not just un-linked.
            {view.key === "place" && (
              <> {t("Any place enclosed by this one is reattached to its parent instead of being left orphaned.")}</>
            )}
            {view.key === "topics" && (
              <> {t("Every message in it is deleted too, not just the discussion itself.")}</>
            )}
            {view.key === "generated" && (
              <> {t("You can generate it again from the tree at any time.")}</>
            )}{" "}
            {t("This cannot be undone from here.")}
          </Text>
          {error && (
            <Alert color="red" title={t("Could not delete")}>
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              {t("Cancel")}
            </Button>
            <Button color="red" onClick={handleDelete} loading={deleting}>
              {t("Delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
