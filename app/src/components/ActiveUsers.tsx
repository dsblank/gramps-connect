import { useSyncExternalStore } from "react";
import { Avatar, Tooltip, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getCurrentUsername, getToken, hasPermissions } from "../auth/auth";
import { getActiveUsers, subscribeActiveUsers } from "../store/activeUsers";
import { openOrCreateUserTopic } from "../store/topicsApi";
import { openTopicWindow } from "../store/topicWindows";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../store/userDirectory";
import { colorForUsername, initialsFor } from "../store/userAvatar";
import { t } from "../i18n/i18n";

// Retries a transient failure (a dropped request, a token-refresh race) a
// couple of times before giving up -- this click has no dialog of its own
// to show a retry button in, so it gets one chance to recover silently
// before messageUser() surfaces anything to the user.
const RETRY_DELAYS_MS = [300, 1000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Opens (or starts) the 1:1 topic with `peer` as a floating chat window --
 * replaces the old dmUi.ts's openDmThread()/DmThread.tsx modal now that a
 * DM is just an ordinary, unlisted Topic (topicsApi.ts's
 * openOrCreateUserTopic). Deliberately doesn't navigate anywhere, same
 * reasoning as DiscussButton.tsx: clicking someone's avatar shouldn't
 * knock you off whatever record or list you're currently looking at.
 *
 * Retries up to RETRY_DELAYS_MS.length times on failure -- this used to
 * swallow any error into console.error alone, so a transient failure left
 * the click looking like it had done nothing at all. Only the final
 * attempt's failure is surfaced, as a toast rather than console.error,
 * since there's no dialog here to show an inline error in. */
async function messageUser(peer: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const token = await getToken();
      const me = getCurrentUsername();
      if (!me) return;
      const handle = await openOrCreateUserTopic(token, me, peer);
      openTopicWindow(handle);
      return;
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) {
        notifications.show({
          color: "red",
          title: t("Couldn't open that discussion"),
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
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
