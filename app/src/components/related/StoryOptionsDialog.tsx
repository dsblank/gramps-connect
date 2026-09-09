import { useState } from "react";
import { Alert, Button, Checkbox, Group, Modal, Stack, Switch, Text } from "@mantine/core";
import type { ObjectDetail } from "../../store/objectDetail";
import { zipRefs } from "../../store/objectDetail";
import type { StoryOptions } from "../../store/storyBuilder";
import type { ViewConfig } from "../../store/views";
import { personName } from "./summary";
import { t } from "../../i18n/i18n";

interface StoryOptionsDialogProps {
  opened: boolean;
  /** "Add a person's story"/"Add a family's story" -- AddStoryControl's own
   * button label, reused as this Modal's title rather than each place
   * naming the story kind on its own. */
  title: string;
  view: ViewConfig;
  detail: ObjectDetail;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onGenerate: (options: StoryOptions) => void;
}

interface Member {
  handle: string;
  label: string;
}

/** Father, mother, and children off a Family's own extend=all shape --
 * everything the "who to include" checklist needs, already resolved on
 * `detail` (no extra fetch, unlike storyBuilder.ts's own per-family fetches
 * for a *person's* related families). "{}" for an unset father/mother is
 * gramps-web-api's convention for a missing forward ref (see
 * ParentsSection.tsx's doc comment on the same shape), so a handle check
 * doubles as the presence check here. */
function familyMembers(detail: ObjectDetail): Member[] {
  const father = detail.extended?.father as { handle?: string } | undefined;
  const mother = detail.extended?.mother as { handle?: string } | undefined;
  const children = zipRefs<{ handle?: string }>(detail.child_ref_list, detail.extended?.children)
    .map((row) => row.target)
    .filter((p): p is { handle: string } => Boolean(p?.handle));
  return [father, mother]
    .filter((p): p is { handle: string } => Boolean(p?.handle))
    .concat(children)
    .map((p) => ({ handle: p.handle, label: personName(p) }));
}

/** Options for "+ Add a story" (NotesSection.tsx's AddStoryControl), one
 * field per StoryOptions member -- a person gets a single "include
 * families" toggle (storyBuilder.ts's buildPersonStory pulls in every
 * family this person belongs to, as parent or as child, when it's on --
 * named for what it draws on rather than "events", since it also pulls in
 * relatives, not just the events themselves), a family
 * gets one checkbox per member so a household story can leave out whoever
 * isn't wanted (buildFamilyStory's excludedMemberHandles). Kept as its own
 * dialog rather than folded into AddStoryControl so a future third seeding
 * rule (see storyBuilder.ts's own doc comment on Places/Events) only has to
 * add a branch here, not restructure the button. */
export function StoryOptionsDialog({ opened, title, view, detail, busy, error, onClose, onGenerate }: StoryOptionsDialogProps) {
  const isFamily = view.key === "family";
  const members = isFamily ? familyMembers(detail) : [];
  const [includeFamilyEvents, setIncludeFamilyEvents] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  function toggleMember(handle: string, include: boolean) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (include) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  function handleGenerate() {
    onGenerate(
      isFamily
        ? { excludedMemberHandles: excluded }
        : { includeFamilyEvents }
    );
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title} size="sm">
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}

        {isFamily ? (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              {t("Include each person's own birth and death in this family's story:")}
            </Text>
            {members.map((member) => (
              <Checkbox
                key={member.handle}
                label={member.label}
                checked={!excluded.has(member.handle)}
                onChange={(event) => toggleMember(member.handle, event.currentTarget.checked)}
              />
            ))}
          </Stack>
        ) : (
          <Switch
            label={t("Include families")}
            description={t(
              "Also draw on this person's own families: a spouse's and children's births and deaths, and their parents' and siblings'."
            )}
            checked={includeFamilyEvents}
            onChange={(event) => setIncludeFamilyEvents(event.currentTarget.checked)}
          />
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button onClick={handleGenerate} loading={busy}>
            {t("Generate")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
