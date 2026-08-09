import { useState } from "react";
import { Alert, Button, Group, Modal, Textarea } from "@mantine/core";
import { getToken, getCurrentUsername } from "../auth/auth";
import { getViewStore } from "../store/registry";
import { createTeamNote } from "../store/notesApi";

/** Trigger + compose form for a new Gramps Connect message -- the app's
 * first Mantine Modal (no dialog/overlay component exists anywhere else
 * yet). Rendered in App.tsx's AppShell.Main for the "team_note" view only,
 * in the space FilterBar leaves empty there (TEAM_NOTES_VIEW.searchable is
 * false). */
export function TeamNoteComposer() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setOpen(false);
    setText("");
    setError(null);
  }

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await createTeamNote(token, getCurrentUsername() ?? "unknown", text.trim());
      close();
      // Immediate feedback for the author, rather than waiting on the next
      // live-sync poll tick (up to POLL_INTERVAL_MS) to see their own note.
      getViewStore("team_note").requeryDebounced();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Group mb="sm">
        <Button size="xs" onClick={() => setOpen(true)}>+ New message</Button>
      </Group>
      <Modal opened={open} onClose={close} title="New Gramps Connect message">
        <Textarea
          autosize
          minRows={4}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder="Message for anyone with edit access..."
          disabled={saving}
        />
        {error && <Alert color="red" mt="sm">{error}</Alert>}
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!text.trim()}>Save</Button>
        </Group>
      </Modal>
    </>
  );
}
