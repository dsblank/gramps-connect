import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Button, Group, ScrollArea, Stack, Text, Textarea } from "@mantine/core";
import { getToken, getCurrentUsername, hasPermissions } from "../../auth/auth";
import {
  deleteTopicMessage, fetchTopicMessages, postTopicMessage, updateTopicMessage, type TopicChatMessage,
} from "../../store/topicsApi";
import { getTopicActivityVersion, subscribeTopicActivity } from "../../store/topicWindows";
import { ChatBubble } from "./ChatBubble";
import { t } from "../../i18n/i18n";

// Mac uses Cmd (⌘) as its "submit" modifier convention, everyone else
// Ctrl -- same as the old MessageComposer.tsx.
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const sendShortcutLabel = isMac ? "⌘+Enter" : "Ctrl+Enter";

const MESSAGE_LIMIT = 200;

/** Chat body for a Topic -- history + composer, today only ever mounted by
 * FloatingTopicWindow.tsx, but written with no dependency on that (just
 * `topicHandle` and the `historyHeight` layout knob) in case something
 * else wants one later. Self-refetches on topicWindows.ts's activity
 * counter (bumped by App.tsx's onRemoteNoteChange for every live-synced
 * Note change) rather than taking a `revision` prop from a parent that may
 * not have one to give -- a floating window isn't a RelatedPanel mounting
 * tied to any ViewStore selection, so there's no natural revision to thread
 * through here. This is also what makes an edit or delete (this window's
 * own, via editMessage/removeMessage below, or another tab/user's) show up
 * here promptly rather than waiting for a live-sync poll: this window's own
 * write bumps `loadNonce` directly (immediate, no round trip), and a
 * remote one arrives through the same activity counter every other note
 * change already does. */
export function TopicThread({ topicHandle, historyHeight = 400 }: { topicHandle: string; historyHeight?: number }) {
  const [messages, setMessages] = useState<TopicChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const activityVersion = useSyncExternalStore(subscribeTopicActivity, getTopicActivityVersion);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const fetched = await fetchTopicMessages(token, topicHandle, MESSAGE_LIMIT);
        if (!cancelled) setMessages(fetched);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topicHandle, activityVersion, loadNonce]);

  // Jump to the bottom whenever the thread grows -- this author's own
  // just-sent message, or another user's arriving via the next live-sync
  // poll tick (same reasoning the old MessageComposer.tsx had).
  const viewportRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, [messages?.length]);

  async function send() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await postTopicMessage(token, topicHandle, getCurrentUsername() ?? "unknown", text.trim());
      setText("");
      setLoadNonce((n) => n + 1);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  // Same EditObject/DeleteObject gate every other object edit/delete in
  // this app uses (DeleteButton.tsx, NotesSection.tsx's canAttach, ...) --
  // not restricted to "your own" messages, since no such per-author
  // permission concept exists anywhere else here either (author is just
  // embedded text, not a real ownership field the server tracks). Errors
  // thrown here surface in the bubble's own Alert (ChatBubble.tsx), so
  // there's nothing to catch beyond letting them propagate.
  const canEditMessages = hasPermissions("EditObject");
  const canDeleteMessages = hasPermissions("DeleteObject");

  async function editMessage(message: TopicChatMessage, newText: string) {
    const token = await getToken();
    await updateTopicMessage(token, message.handle, topicHandle, message.author, newText);
    setLoadNonce((n) => n + 1);
  }

  async function removeMessage(message: TopicChatMessage) {
    const token = await getToken();
    await deleteTopicMessage(token, message.handle);
    setLoadNonce((n) => n + 1);
  }

  return (
    <Stack gap="sm">
      <ScrollArea.Autosize mah={historyHeight} offsetScrollbars viewportRef={(node) => { viewportRef.current = node; }}>
        <Stack gap="sm" py={2}>
          {(messages ?? []).map((message) => (
            <ChatBubble
              key={message.handle}
              message={message}
              mine={message.author === getCurrentUsername()}
              onEdit={canEditMessages ? (newText) => editMessage(message, newText) : undefined}
              onDelete={canDeleteMessages ? () => removeMessage(message) : undefined}
            />
          ))}
          {messages?.length === 0 && <Text size="sm" c="dimmed">{t("No messages yet — be the first to post.")}</Text>}
        </Stack>
      </ScrollArea.Autosize>
      <Textarea
        autosize
        minRows={3}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Plain Enter stays a newline (this is a multi-line textarea);
          // Ctrl/Cmd+Enter is the send shortcut, matching sendShortcutLabel.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !saving) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={t("Message this discussion…")}
        disabled={saving}
      />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button onClick={send} loading={saving} disabled={!text.trim()}>
          {t("Send")} ({sendShortcutLabel})
        </Button>
      </Group>
    </Stack>
  );
}
