import { useState, useSyncExternalStore } from "react";
import { Alert, Box, Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { formatChange, formatChangeTitle } from "../../store/views";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../../store/userDirectory";
import { bubbleColorForUsername } from "../../store/userAvatar";
import { CircleGlyphButton } from "../CircleGlyphButton";
import { t } from "../../i18n/i18n";

export interface ChatMessage {
  author: string;
  text: string;
  change?: number;
}

/** One chat-style bubble: the author's name (small, above) then their
 * message text in a rounded, author-colored box -- right-justified and
 * unlabeled-as-"me" for the signed-in user's own messages (their name is
 * still shown, same as everyone else's, just on the right), left-justified
 * for everyone else's. Extracted from the old MessageComposer.tsx --
 * already participant-count-agnostic (keys only on `author`), so no
 * changes were needed to reuse it for an open-ended Topic thread instead of
 * a 2-party DM or single-object comment thread.
 *
 * `onEdit`/`onDelete` are optional so a read-only history (none exists
 * today, but nothing here assumes otherwise) can render the exact same
 * bubble with neither control -- TopicThread.tsx's own permission checks
 * decide whether to pass them at all, not this component. Editing swaps
 * the bubble's own body for a Textarea in place (same bubble, no separate
 * dialog) since a chat-style correction is a small, in-context edit, not a
 * record-editing workflow. */
export function ChatBubble({
  message, mine, onEdit, onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  onEdit?: (newText: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  // Re-renders once the background directory load (App.tsx's
  // loadUserDirectory) resolves -- it usually hasn't finished yet the first
  // time a thread renders, so this bubble would otherwise be stuck showing
  // the raw username until something else happened to re-render it.
  useSyncExternalStore(subscribeUserDirectory, getUserDirectoryVersion);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same per-user color as their Avatar elsewhere (UserMenu, ActiveUsers)
  // -- see userAvatar.ts's bubbleColorForUsername doc comment for why this
  // is a snapped-to-named-color variant of that hue rather than the same
  // raw hsl() value those Avatars use.
  const color = bubbleColorForUsername(message.author);

  function startEdit() {
    setDraft(message.text);
    setError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!draft.trim() || !onEdit) return;
    setBusy(true);
    setError(null);
    try {
      await onEdit(draft.trim());
      setEditing(false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!window.confirm(t("Delete this message? There is no undo."))) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      // No setBusy(false)/setEditing here on success -- this bubble is
      // about to be removed from the thread entirely (TopicThread.tsx
      // refetches), so there's nothing left to reset state on.
    } catch (err: any) {
      setError(err.message ?? String(err));
      setBusy(false);
    }
  }

  return (
    <Stack gap={2} align={mine ? "flex-end" : "flex-start"}>
      <Group gap={6} px={4} wrap="nowrap">
        <Text size="xs" c="dimmed">{displayName(message.author)}</Text>
        {message.change != null && (
          <Text size="xs" c="dimmed" title={formatChangeTitle(message.change)}>
            {formatChange(message.change)}
          </Text>
        )}
        {!editing && onEdit && (
          <CircleGlyphButton glyph="✎" label={t("Edit message")} onClick={startEdit} size={14} />
        )}
        {!editing && onDelete && (
          <CircleGlyphButton glyph="🗑" label={t("Delete message")} onClick={handleDelete} size={14} disabled={busy} />
        )}
      </Group>
      {editing ? (
        <Box style={{ width: "min(100%, 22rem)" }}>
          <Textarea
            autosize
            minRows={2}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
                e.preventDefault();
                saveEdit();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            disabled={busy}
            autoFocus
          />
          {error && <Alert color="red" mt={4}>{error}</Alert>}
          <Group justify="flex-end" gap={6} mt={4}>
            <Button variant="default" size="xs" onClick={() => setEditing(false)} disabled={busy}>
              {t("Cancel")}
            </Button>
            <Button size="xs" onClick={saveEdit} loading={busy} disabled={!draft.trim()}>
              {t("Save")}
            </Button>
          </Group>
        </Box>
      ) : (
        <>
          <Box
            px="sm"
            py={6}
            style={{
              maxWidth: "80%",
              background: `var(--mantine-color-${color}-light)`,
              color: "var(--mantine-color-black)",
              borderRadius: "var(--mantine-radius-lg)",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            <Text size="sm" inherit>{message.text}</Text>
          </Box>
          {error && <Alert color="red">{error}</Alert>}
        </>
      )}
    </Stack>
  );
}
