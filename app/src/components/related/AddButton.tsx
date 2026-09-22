import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Textarea, TextInput } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { createBlogPost } from "../../store/blogApi";
import { getViewStore } from "../../store/registry";
import { createTopic } from "../../store/topicsApi";
import { openTopicWindow } from "../../store/topicWindows";
import { DRAFT_TYPE_LABELS, EDITABLE_TYPES, type DraftType, type UseDraftStack } from "../../store/draftStack";
import type { ViewConfig } from "../../store/views";
import { ParticipantsInput } from "./ParticipantsInput";
import { t } from "../../i18n/i18n";

const PERM_ADD_OBJ = "AddObject";
const PERM_EDIT_OBJ = "EditObject";

/** "a Person"/"an Event" -- matches MenuBar.tsx's own un-translated
 * `New ${DRAFT_TYPE_LABELS[type]}…` interpolation, since these singular
 * names aren't Gramps desktop msgids either. */
function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

/** The Discussions view's own "Add" button -- a Topic isn't a DraftType (it
 * has no generic edit-dialog form, see EditTopicButton.tsx's own doc
 * comment), so this is a small dedicated create dialog rather than
 * draftStack.ts's stacked flow, same reasoning the old board-message "Add a
 * ToDo" had for using MessageComposer's own modal instead. Requeries the
 * Discussions ViewStore (same as every other view's own create path) and
 * opens the new discussion straight away as a floating window
 * (topicWindows.ts) rather than navigating there -- there's nowhere better
 * to start typing a first message than right after naming it. */
function NewTopicButton() {
  const [opened, setOpened] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions(PERM_ADD_OBJ)) return null;

  function close() {
    setOpened(false);
    setTitle("");
    setDescription("");
    setParticipants([]);
    setError(null);
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const handle = await createTopic(token, title.trim(), description.trim() || undefined, participants);
      getViewStore("topics").requeryDebounced();
      openTopicWindow(handle);
      close();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="xs" onClick={() => setOpened(true)}>{t("Start a discussion")}</Button>
      <Modal opened={opened} onClose={close} title={t("New discussion")}>
        <Stack gap="sm">
          <TextInput label={t("Title")} value={title} onChange={(e) => setTitle(e.currentTarget.value)} autoFocus />
          <Textarea label={t("Description")} value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />
          <ParticipantsInput value={participants} onChange={setParticipants} />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={saving}>{t("Cancel")}</Button>
            <Button onClick={save} loading={saving} disabled={!title.trim()}>{t("Create")}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** The Blog view's own "Add" button -- a blog post isn't a DraftType either
 * (same reasoning as NewTopicButton above: title+author+content don't match
 * any generic ObjectEditDialog form, and gramps-web's own ancestor used a
 * dedicated view for exactly this reason too, see GrampsjsViewNewBlogPost.js),
 * so this is a small dedicated create dialog rather than draftStack.ts's
 * stacked flow. Just requeries the Blog ViewStore and closes (blogApi.ts's
 * createBlogPost already does the requery) -- same "no auto-select/navigate"
 * behavior the generic DraftType create flow has (draftStack.ts's saveAll),
 * not gramps-web's own immediate-navigate-to-the-reading-page: the new post
 * sorts to the top of the table either way, one click away. */
function NewBlogPostButton() {
  const [opened, setOpened] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions(PERM_ADD_OBJ)) return null;

  function close() {
    setOpened(false);
    setTitle("");
    setAuthor("");
    setContent("");
    setError(null);
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await createBlogPost(token, title.trim(), author.trim(), content.trim());
      close();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="xs" onClick={() => setOpened(true)}>{t("New blog post")}</Button>
      <Modal opened={opened} onClose={close} title={t("New blog post")}>
        <Stack gap="sm">
          <TextInput label={t("Title")} value={title} onChange={(e) => setTitle(e.currentTarget.value)} autoFocus />
          <TextInput label={t("Author")} value={author} onChange={(e) => setAuthor(e.currentTarget.value)} />
          <Textarea label={t("Content")} value={content} onChange={(e) => setContent(e.currentTarget.value)} autosize minRows={6} />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={saving}>{t("Cancel")}</Button>
            <Button onClick={save} loading={saving} disabled={!title.trim()}>{t("Create")}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** The list's own "create a new one" action -- lives beside RelatedPanel's
 * Edit/Delete/etc for the selected record (and in AsideSplit's empty/merge
 * states, so it stays reachable however many rows are selected) rather than
 * in ListHeader above the table: a per-type create action reads more like
 * "one more thing you can do with this record type" than a property of the
 * list itself, the same reasoning that already grouped it with Edit/Delete
 * in every other object-detail surface in this app. "Add a Person"/"Add an
 * Event" (singular DraftType label, withArticle() above) opens the same
 * stacked create dialog as MenuBar's "Add" menu (draftStack.ts); Discussions
 * and Blog aren't DraftTypes at all, so they render NewTopicButton's/
 * NewBlogPostButton's own dedicated dialogs instead.
 *
 * "story" is excluded the same way MenuBar.tsx excludes it from its own Add
 * dropdown: a blank story has no person to attach to, only the person-scoped
 * generate flow creates one. Media/Output have no create dialog at all (not
 * in EDITABLE_TYPES), so nothing renders for those. */
export function AddButton({ view, draftStack }: { view: ViewConfig; draftStack?: UseDraftStack }) {
  if (view.key === "topics") return <NewTopicButton />;
  if (view.key === "blog") return <NewBlogPostButton />;

  const type = view.key as DraftType;
  const canAdd =
    type !== "story" &&
    EDITABLE_TYPES.includes(type) &&
    hasPermissions(...(type === "family" ? [PERM_ADD_OBJ, PERM_EDIT_OBJ] : [PERM_ADD_OBJ]));
  if (!canAdd || !draftStack) return null;

  return (
    <Button size="xs" onClick={() => draftStack.openDraft(type)}>
      Add {withArticle(DRAFT_TYPE_LABELS[type])}
    </Button>
  );
}
