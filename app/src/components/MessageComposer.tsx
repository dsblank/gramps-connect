import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Box, Button, Group, Modal, ScrollArea, Stack, Text, Textarea } from "@mantine/core";
import { getToken, getCurrentUsername } from "../auth/auth";
import { getViewStore } from "../store/registry";
import { createMessage } from "../store/notesApi";
import { formatChange, formatChangeTitle } from "../store/views";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../store/userDirectory";
import { t } from "../i18n/i18n";

export interface ChatMessage {
  author: string;
  text: string;
  change?: number;
}

// Rotating background for each distinct author -- stable across renders
// (and across the app, since it's keyed only on the name) via a simple
// string hash into Mantine's own named color list, rather than assigning
// colors in first-seen order (which would shuffle whenever the fetched
// order changes) or picking one at random.
const BUBBLE_COLORS = ["blue", "grape", "teal", "orange", "cyan", "pink", "lime", "indigo", "red", "violet"];

function colorForAuthor(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i++) hash = (hash * 31 + author.charCodeAt(i)) >>> 0;
  return BUBBLE_COLORS[hash % BUBBLE_COLORS.length];
}

/** One chat-style bubble: the author's name (small, above) then their
 * message text in a rounded, author-colored box -- right-justified and
 * unlabeled-as-"me" for the signed-in user's own messages (their name is
 * still shown, same as everyone else's, just on the right), left-justified
 * for everyone else's. */
function MessageBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  // Re-renders once the background directory load (App.tsx's
  // loadUserDirectory) resolves -- it usually hasn't finished yet the first
  // time a thread renders, so this bubble would otherwise be stuck showing
  // the raw username until something else happened to re-render it.
  useSyncExternalStore(subscribeUserDirectory, getUserDirectoryVersion);
  const color = colorForAuthor(message.author);
  return (
    <Stack gap={2} align={mine ? "flex-end" : "flex-start"}>
      <Group gap={6} px={4} wrap="nowrap">
        <Text size="xs" c="dimmed">{displayName(message.author)}</Text>
        {message.change != null && (
          <Text size="xs" c="dimmed" title={formatChangeTitle(message.change)}>
            {formatChange(message.change)}
          </Text>
        )}
      </Group>
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
    </Stack>
  );
}

interface MessageComposerProps {
  /** The trigger UI, wrapping the given `open` call -- ListHeader.tsx
   * renders it as the Messages view's own "Add" button (matching every
   * other view's), MessageButton.tsx as a small icon that pre-targets the
   * modal at one object. */
  renderTrigger: (open: () => void) => ReactNode;
  /** Called with the newly created note's handle (and the token already
   * fetched to create it, so callers needing a follow-up authenticated
   * request -- MessageButton's attachNoteToObject -- don't need a second
   * getToken()) right after createMessage succeeds, inside the same
   * try/catch as the create call itself: a failure here surfaces in the
   * same error Alert and leaves the modal open, same as any other save
   * failure, rather than silently losing the "this note should also be
   * attached somewhere" step. */
  onSaved?: (noteHandle: string, token: string) => Promise<void> | void;
  /** Which object this message will be attached to, shown as a hint line
   * above the text area. ListHeader's own trigger leaves it unset -- that
   * message is about nothing in particular -- while MessageButton passes the
   * panel's current object, so the author can tell from the modal alone
   * whose record they are about to comment on (the modal covers the panel
   * that would otherwise say). */
  about?: ReactNode;
  /** Prior messages about the same object (oldest first), rendered as a
   * chat thread above the compose box -- only MessageButton.tsx passes
   * this (it's the only caller with an object, and thus a note_list, to
   * read them from); ListHeader's own trigger leaves it unset, same as
   * `about`. */
  history?: ChatMessage[];
}

/** Compose form for a new Gramps Connect message -- the app's first Mantine
 * Modal (no dialog/overlay component exists anywhere else yet). Mounted by
 * ListHeader.tsx for the "messages" view's own "Add" button, and per-object
 * by MessageButton.tsx with a custom trigger and an onSaved that links the
 * note to that object. */
export function MessageComposer({ renderTrigger, onSaved, about, history }: MessageComposerProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // History reads oldest-first (chat order), so the most recent message is
  // the one scrolled out of view by default -- jump the pane to its bottom
  // so the latest message is what the author sees, same as any chat app. A
  // ref callback rather than a plain ref + effect keyed on `open`: Mantine's
  // Modal mounts its children (via its own internal Transition) on a tick
  // after `opened` flips true, so an effect keyed on this component's own
  // `open` state fires before the ScrollArea viewport div actually exists.
  // The callback fires exactly when that div is inserted, whenever that is;
  // the rAF inside it defers past that same paint so scrollHeight already
  // reflects the fully laid-out message list instead of a pre-layout 0.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottom = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, []);

  // The dialog now stays open after sending (and can sit open while a live-
  // sync poll brings in someone else's reply), so the initial mount-time
  // scroll above isn't enough -- re-scroll to bottom any time the thread
  // grows, whether that's this author's own just-sent message or another
  // user's arriving via the poll.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, [history?.length]);

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
      setText("");
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
      {renderTrigger(() => setOpen(true))}
      <Modal opened={open} onClose={close}>
        {about && (
          <Text size="sm" c="dimmed" mb="xs">
            {about}
          </Text>
        )}
        {history && history.length > 0 && (
          <ScrollArea.Autosize mah={300} mb="md" offsetScrollbars viewportRef={scrollToBottom}>
            <Stack gap="sm" py={2}>
              {history.map((message, i) => (
                <MessageBubble key={i} message={message} mine={message.author === getCurrentUsername()} />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
        <Textarea
          autosize
          minRows={4}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={t("Message for collaborators...")}
          disabled={saving}
        />
        {error && <Alert color="red" mt="sm">{error}</Alert>}
        <Group justify="flex-end" mt="md">
          <Button onClick={save} loading={saving} disabled={!text.trim()}>{t("Send")}</Button>
        </Group>
      </Modal>
    </>
  );
}
