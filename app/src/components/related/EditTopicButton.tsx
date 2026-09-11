import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Textarea, TextInput } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { parseTopicSpec, updateTopic, type TopicSpec } from "../../store/topicsApi";
import { bumpTopicActivity } from "../../store/topicWindows";
import type { ObjectDetail } from "../../store/objectDetail";
import { ParticipantsInput } from "./ParticipantsInput";
import { t } from "../../i18n/i18n";

/** Renaming/describing a Topic doesn't go through the generic Note edit
 * dialog (ObjectEditDialog.tsx would present its JSON-in-text body as a
 * raw text field, same reason "messages"/"generated" are kept out of
 * EDITABLE_TYPES, draftStack.ts) -- this is its own small dialog instead,
 * same "+"/action-row shape as EditButton.tsx but writing through
 * topicsApi.ts's updateTopic. Same title/description/participants fields
 * DiscussButton.tsx's "start a new discussion" form collects, so a topic
 * started in a hurry can always be filled in (or corrected) later.
 *
 * Only ever rendered on RelatedPanel's own "topics" management page (see
 * the plan the user asked for: "I don't think we need the Edit button in
 * the chat"), which is a separate component instance from any
 * FloatingTopicWindow showing this same discussion -- `onSaved` alone only
 * refreshes *this* mounting (RelatedPanel's own refetchNonce). Without
 * bumpTopicActivity() too, a discussion's already-open floating window
 * would keep showing its old title until the next unrelated live-sync
 * poll tick happened to touch it (confirmed live: it doesn't otherwise
 * update at all, since useLiveSync's own guard skips notifying the very
 * client that made the change). Same fix in LinkObjectControl.tsx/
 * TopicLinksSection.tsx, for the same reason. */
export function EditTopicButton({ detail, onSaved }: { detail: ObjectDetail; onSaved: () => void }) {
  const [opened, setOpened] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions("EditObject")) return null;

  function open() {
    const spec = parseTopicSpec((detail.text as { string?: string } | undefined)?.string);
    setTitle(spec.title);
    setDescription(spec.description ?? "");
    setParticipants(spec.participants ?? []);
    setError(null);
    setOpened(true);
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const spec: TopicSpec = { title: title.trim() };
      if (description.trim()) spec.description = description.trim();
      if (participants.length > 0) spec.participants = participants;
      await updateTopic(token, detail.handle, spec);
      bumpTopicActivity();
      setOpened(false);
      onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={open}>
        {t("Edit")}
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t("Edit discussion")}>
        <Stack gap="sm">
          <TextInput label={t("Title")} value={title} onChange={(e) => setTitle(e.currentTarget.value)} autoFocus />
          <Textarea label={t("Description")} value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />
          <ParticipantsInput value={participants} onChange={setParticipants} />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)} disabled={saving}>{t("Cancel")}</Button>
            <Button onClick={save} loading={saving} disabled={!title.trim()}>{t("Save")}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
