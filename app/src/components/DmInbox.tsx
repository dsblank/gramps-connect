import { useEffect, useState, useSyncExternalStore } from "react";
import { ActionIcon, Autocomplete, Divider, Group, Indicator, Popover, Stack, Text, UnstyledButton } from "@mantine/core";
import { getToken, getCurrentUsername, hasPermissions } from "../auth/auth";
import { fetchMyDmPool, getDmActivityVersion, groupDmConversations, subscribeDmActivity, type DmMessage } from "../store/dmApi";
import { getKnownUsers, loadKnownUsersFromDirectory, subscribeKnownUsers } from "../store/knownUsers";
import { isUnread } from "../store/dmReadState";
import { openDmThread } from "../store/dmUi";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../store/userDirectory";
import { formatChange, formatChangeTitle } from "../store/views";
import { t } from "../i18n/i18n";
import iconChat from "../assets/icons/chat-message.svg";

interface Conversation {
  partner: string;
  lastMessage: DmMessage;
  unread: boolean;
}

function toConversations(me: string, pool: Awaited<ReturnType<typeof fetchMyDmPool>>): Conversation[] {
  const byPartner = groupDmConversations(me, pool);
  const conversations: Conversation[] = [];
  for (const [partner, messages] of byPartner) {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) continue;
    const newestIncoming = [...messages].reverse().find((m) => m.author === partner)?.change;
    conversations.push({ partner, lastMessage, unread: isUnread(partner, newestIncoming) });
  }
  return conversations.sort((a, b) => (b.lastMessage.change ?? 0) - (a.lastMessage.change ?? 0));
}

/** Header icon (next to ActiveUsers/UserMenu) listing every DM conversation
 * the signed-in user is part of, plus a "new message" picker for starting
 * one with someone not already in the list. Refetches whenever
 * dmApi.ts's bumpDmActivity() fires (a DM I just sent, or an incoming one
 * App.tsx's live-sync handler noticed) so the unread badge stays current
 * even while this popover is closed. */
export function DmInbox() {
  const activityVersion = useSyncExternalStore(subscribeDmActivity, getDmActivityVersion);
  useSyncExternalStore(subscribeUserDirectory, getUserDirectoryVersion);
  const knownUsers = useSyncExternalStore(subscribeKnownUsers, getKnownUsers);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const me = getCurrentUsername() ?? "";
      const pool = await fetchMyDmPool(token, me, 1000);
      if (cancelled) return;
      setConversations(toConversations(me, pool));
    })().catch((err) => console.error("failed to load DM inbox", err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on every live-sync-driven bump, not just mount
  }, [activityVersion]);

  useEffect(() => {
    // A user account created after this session's one-shot load in
    // App.tsx (loadKnownUsersFromDirectory()) would otherwise stay
    // invisible to the recipient picker below for the rest of the
    // session -- force a refetch each time the popover opens, since
    // that's the moment staleness would actually be noticed.
    if (opened) loadKnownUsersFromDirectory(true);
  }, [opened]);

  const unreadCount = conversations.filter((c) => c.unread).length;
  const canCompose = hasPermissions("AddObject");

  return (
    <Popover width={320} opened={opened} onChange={setOpened} withArrow position="bottom-end">
      <Popover.Target>
        <Indicator disabled={unreadCount === 0} label={unreadCount} size={16} color="red">
          <ActionIcon variant="subtle" onClick={() => setOpened((o) => !o)} aria-label={t("Direct messages")}>
            <img src={iconChat} alt="" width={18} height={18} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          {canCompose && (
            <Autocomplete
              size="xs"
              placeholder={t("Message a user (type a username)…")}
              data={knownUsers}
              value={newRecipient}
              onChange={setNewRecipient}
              onOptionSubmit={(value) => {
                setOpened(false);
                setNewRecipient("");
                openDmThread(value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newRecipient.trim()) {
                  setOpened(false);
                  const recipient = newRecipient.trim();
                  setNewRecipient("");
                  openDmThread(recipient);
                }
              }}
            />
          )}
          {conversations.length === 0 && (
            <Text size="sm" c="dimmed">{t("No direct messages yet.")}</Text>
          )}
          {conversations.length > 0 && <Divider />}
          <Stack gap={4}>
            {conversations.map(({ partner, lastMessage, unread }) => (
              <UnstyledButton
                key={partner}
                onClick={() => {
                  setOpened(false);
                  openDmThread(partner);
                }}
              >
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="sm" fw={unread ? 700 : 400} truncate>
                    {displayName(partner)}
                  </Text>
                  {lastMessage.change != null && (
                    <Text size="xs" c="dimmed" title={formatChangeTitle(lastMessage.change)}>
                      {formatChange(lastMessage.change)}
                    </Text>
                  )}
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {lastMessage.text}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
