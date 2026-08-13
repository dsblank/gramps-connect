import { useState, type ReactNode } from "react";
import { Alert, Button, Group, Modal, Textarea } from "@mantine/core";
import { getToken, getCurrentUsername } from "../auth/auth";
import { getViewStore } from "../store/registry";
import { createMessage } from "../store/notesApi";

interface MessageComposerProps {
  /** Defaults to the plain "+ New message" button App.tsx has always shown
   * for the untargeted Messages-view composer. A caller wanting a
   * different trigger (e.g. MessageButton's small icon, opening the same
   * modal pre-targeted at one object) passes its own render function
   * instead; either way it just needs to call the given `open`. */
  renderTrigger?: (open: () => void) => ReactNode;
  /** Called with the newly created note's handle (and the token already
   * fetched to create it, so callers needing a follow-up authenticated
   * request -- MessageButton's attachNoteToObject -- don't need a second
   * getToken()) right after createMessage succeeds, inside the same
   * try/catch as the create call itself: a failure here surfaces in the
   * same error Alert and leaves the modal open, same as any other save
   * failure, rather than silently losing the "this note should also be
   * attached somewhere" step. */
  onSaved?: (noteHandle: string, token: string) => Promise<void> | void;
}

/** Compose form for a new Gramps Connect message -- the app's first Mantine
 * Modal (no dialog/overlay component exists anywhere else yet). Default
 * mounting is in App.tsx's AppShell.Main for the "messages" view only, in
 * the space FilterBar leaves empty there (MESSAGES_VIEW.searchable is
 * false); also mounted per-object by MessageButton.tsx with a custom
 * trigger and an onSaved that links the note to that object. */
export function MessageComposer({ renderTrigger, onSaved }: MessageComposerProps) {
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
      const noteHandle = await createMessage(token, getCurrentUsername() ?? "unknown", text.trim());
      if (onSaved) await onSaved(noteHandle, token);
      close();
      // Immediate feedback for the author, rather than waiting on the next
      // live-sync poll tick (up to POLL_INTERVAL_MS) to see their own note.
      getViewStore("messages").requeryDebounced();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
        <Group mb="sm">
          <Button size="xs" onClick={() => setOpen(true)}>+ New message</Button>
        </Group>
      )}
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
