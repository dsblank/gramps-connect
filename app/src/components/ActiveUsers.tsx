import { useSyncExternalStore } from "react";
import { Avatar, Tooltip } from "@mantine/core";
import { getActiveUsers, subscribeActiveUsers } from "../store/activeUsers";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../store/userDirectory";
import { colorForUsername, initialsFor } from "../store/userAvatar";

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

  return (
    <Avatar.Group>
      {visible.map((username) => (
        <Tooltip key={username} label={displayName(username)} withArrow>
          {/* color/variant (not an inline style) so Mantine derives the
              placeholder text's own color var from this background -- an
              inline style on the root doesn't reach that nested span, which
              is why this used to render low-contrast grey text on every
              color. See userAvatar.ts's doc comment. */}
          <Avatar radius="xl" size="sm" color={colorForUsername(username)} variant="filled">
            {initialsFor(displayName(username))}
          </Avatar>
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
