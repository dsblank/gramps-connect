import { useSyncExternalStore } from "react";
import { TagsInput } from "@mantine/core";
import { getKnownUsers, isGuestUser, subscribeKnownUsers } from "../../store/knownUsers";
import { t } from "../../i18n/i18n";

/** Free-text multi-value username picker for a topic's invited
 * participants (topicsApi.ts's TopicSpec.participants) -- suggests from
 * knownUsers.ts's own list (every username this session has seen edit
 * something, plus the real user list for a role that can see it) but
 * doesn't require picking from it: a username no one's seen yet is still a
 * valid, freely-typed tag, same reasoning the old DM composer's recipient
 * field had for not requiring a known username. Shared by DiscussButton.tsx
 * (starting a new discussion), ListHeader.tsx's NewTopicButton, and
 * EditTopicButton.tsx (editing an existing topic's invite list) so the
 * three "describe a topic" forms all look and behave identically.
 *
 * Guests are already left out of `data` by knownUsers.ts's snapshot, but a
 * freely-typed name bypasses that suggestion list -- so onChange strips any
 * name the directory has confirmed is a guest, same as isGuestUser() is
 * used for. Guests can't be messaged (see auth.ts's isGuest() doc comment),
 * so they're never a valid target no matter how their name got in here. */
export function ParticipantsInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const knownUsers = useSyncExternalStore(subscribeKnownUsers, getKnownUsers);
  return (
    <TagsInput
      label={t("Invite participants")}
      placeholder={t("Type a username and press Enter…")}
      data={knownUsers}
      value={value}
      onChange={(next) => onChange(next.filter((name) => !isGuestUser(name)))}
    />
  );
}
