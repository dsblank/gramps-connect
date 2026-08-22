import { useState } from "react";
import { Alert, Button, Group } from "@mantine/core";
import type { ObjectDetail } from "../../store/objectDetail";
import type { StorySpec } from "../../store/storyBuilder";
import { StoryView } from "../StoryView";
import { t } from "../../i18n/i18n";

/** Parses a story note's text.string back into the StorySpec StoryView
 * expects -- the inverse of storyApi.ts's createStoryNote, which just
 * JSON.stringifies the spec into that same field. Returns null (rather
 * than throwing) for a hand-edited note that's no longer valid JSON, or
 * missing the couple of fields that make it recognizably a StorySpec, so
 * the Present button can disable itself instead of crashing the panel. */
function parseSpec(detail: ObjectDetail): StorySpec | null {
  const text = (detail.text as { string?: string } | undefined)?.string ?? "";
  try {
    const spec = JSON.parse(text);
    if (spec && typeof spec.title === "string" && Array.isArray(spec.points)) return spec as StorySpec;
  } catch {
    // falls through to the null return below
  }
  return null;
}

/** RelatedPanel's `view.key === "story"` action slot -- same spot
 * MessageActions.tsx occupies for `view.key === "messages"`. Just a
 * "Present" trigger for the fullscreen StoryView, since Edit (the JSON
 * dialog) and Delete are already generic across every editable type once
 * "story" is a DraftType (see draftStack.ts) -- this component only needs
 * to own what's story-specific: parsing the spec back out and holding the
 * presentation's open/closed state. */
export function StoryActions({ detail }: { detail: ObjectDetail }) {
  const [opened, setOpened] = useState(false);
  const spec = parseSpec(detail);

  return (
    <Group gap="xs">
      <Button size="xs" onClick={() => setOpened(true)} disabled={!spec}>
        {t("Present")}
      </Button>
      {!spec && (
        <Alert color="red" py={4}>
          {t("This story's JSON couldn't be parsed -- edit it to fix before presenting.")}
        </Alert>
      )}
      <StoryView spec={spec} opened={opened} onClose={() => setOpened(false)} />
    </Group>
  );
}
