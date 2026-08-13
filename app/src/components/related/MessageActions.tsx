import { useState } from "react";
import { Alert, Button, Group } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { toggleMessageDone, deleteMessage } from "../../store/notesApi";
import type { ObjectDetail } from "../../store/objectDetail";
import { zipHandles } from "./sections/shared";

/** Mark done/Reopen + delete for a message, in RelatedPanel's
 * `view.key === "messages"` branch -- same Button+Group+error-Alert shape
 * as GeneratedItemActions.tsx. `onToggled` (not called after delete --
 * see its own call site) tells RelatedPanel to refetch this handle's
 * detail, since the tag write here doesn't otherwise reach the panel's
 * already-fetched `detail` (its Tags section reads the same stale
 * tag_list this component would otherwise be the only place showing the
 * new state). */
export function MessageActions({ detail, onToggled }: { detail: ObjectDetail; onToggled: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const tags = zipHandles<{ name?: string }>(detail.tag_list, detail.extended?.tags);
  const isDone = tags.some((t) => t.target?.name === "todo-done");

  if (deleted) {
    return <Alert color="gray">Message deleted.</Alert>;
  }

  async function handleToggle() {
    setError(null);
    try {
      const token = await getToken();
      await toggleMessageDone(token, detail.handle, !isDone);
      getViewStore("messages").requeryDebounced();
      onToggled();
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this message?")) return;
    setError(null);
    try {
      const token = await getToken();
      await deleteMessage(token, detail.handle);
      setDeleted(true);
      getViewStore("messages").requeryDebounced();
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  return (
    <Group gap="xs">
      <Button size="xs" onClick={handleToggle}>{isDone ? "Reopen" : "Mark done"}</Button>
      <Button size="xs" color="red" variant="subtle" onClick={handleDelete}>Delete</Button>
      {error && <Alert color="red">{error}</Alert>}
    </Group>
  );
}
