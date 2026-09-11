import { useSyncExternalStore } from "react";
import { Avatar, Tooltip, UnstyledButton } from "@mantine/core";
import { getCurrentUsername, getToken, hasPermissions } from "../auth/auth";
import { getActiveUsers, subscribeActiveUsers } from "../store/activeUsers";
import { openOrCreateUserTopic } from "../store/topicsApi";
import { openTopicWindow } from "../store/topicWindows";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../store/userDirectory";
import { colorForUsername, initialsFor } from "../store/userAvatar";
import { t } from "../i18n/i18n";

/** Opens (or starts) the 1:1 topic with `peer` as a floating chat window --
 * replaces the old dmUi.ts's openDmThread()/DmThread.tsx modal now that a
 * DM is just an ordinary, unlisted Topic (topicsApi.ts's
 * openOrCreateUserTopic). Deliberately doesn't navigate anywhere, same
 * reasoning as DiscussButton.tsx: clicking someone's avatar shouldn't
 * knock you off whatever record or list you're currently looking at. */
async function messageUser(peer: string) {
  try {
    const token = await getToken();
    const me = getCurrentUsername();
    if (!me) return;
    const handle = await openOrCreateUserTopic(token, me, peer);
    openTopicWindow(handle);
  } catch (err) {
    console.error("failed to open or create topic with", peer, err);
  }
}

// Avatars beyond this many collapse into a single "+N" one, same idea as
// Mantine's own Avatar.Group truncation but driven manually so the overflow
// avatar can get its own tooltip listing who it's hiding.
const MAX_VISIBLE = 4;

/** Small avatar row for the other users who've edited the tree recently --
 * see activeUsers.ts for what "recently" means and why this can't show
 * users who are only reading. Rendered next to UserMenu in App.tsx's
 * header. Renders nothing when no one else has been active. */
export function ActiveUsers() {
  const usernames = useSyncExternalStore(subscribeActiveUsers, getActiveUsers);
  // Re-renders once full names resolve in the background (App.tsx already
  // kicks off loadUserDirectory() on mount) so avatars' initials/tooltips
  // upgrade from raw usernames without this component triggering its own
  // fetch.
  useSyncExternalStore(subscribeUserDirectory, getUserDirectoryVersion);

  if (usernames.length === 0) return null;

  const visible = usernames.slice(0, MAX_VISIBLE);
  const overflow = usernames.slice(MAX_VISIBLE);
  // Only offer "click an avatar to message them" when the signed-in user
  // could actually post one -- same AddObject gate DiscussButton.tsx/
  // ListHeader.tsx already check before letting someone compose a message.
  const canMessage = hasPermissions("AddObject");

  return (
    <Avatar.Group>
      {visible.map((username) => (
        <Tooltip key={username} label={displayName(username)} withArrow>
          {/* color/variant (not an inline style) so Mantine derives the
              placeholder text's own color var from this background -- an
              inline style on the root doesn't reach that nested span, which
              is why this used to render low-contrast grey text on every
              color. See userAvatar.ts's doc comment. */}
          <UnstyledButton
            onClick={canMessage ? () => messageUser(username) : undefined}
            style={{ cursor: canMessage ? "pointer" : "default" }}
            aria-label={canMessage ? `${t("Message")} ${displayName(username)}` : undefined}
          >
            <Avatar radius="xl" size="sm" color={colorForUsername(username)} variant="filled">
              {initialsFor(displayName(username))}
            </Avatar>
          </UnstyledButton>
        </Tooltip>
      ))}
      {overflow.length > 0 && (
        <Tooltip label={overflow.map(displayName).join(", ")} withArrow>
          <Avatar radius="xl" size="sm">{`+${overflow.length}`}</Avatar>
        </Tooltip>
      )}
    </Avatar.Group>
  );
}
