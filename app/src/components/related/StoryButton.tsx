import { useState } from "react";
import { Text, Tooltip, UnstyledButton } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { attachNoteToObject } from "../../store/notesApi";
import { createStoryNote } from "../../store/storyApi";
import { buildPersonStory, type StorySpec } from "../../store/storyBuilder";
import { loadVisualData } from "../../store/visualData";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";
import { summaryLine } from "./summary";
import { StoryView } from "../StoryView";

/** Pilot: top-right header button (person only) that auto-drafts a story
 * from this person's own events -- see storyBuilder.ts for how each event
 * becomes a point -- writes it as a
 * JSON Note (storyApi.ts), attaches that note to the person the normal way,
 * then opens it straight away in StoryView. Regenerates (and attaches a new
 * note) on every click rather than reusing a previous one -- deliberately
 * the simplest thing that could work, to find out whether the idea is worth
 * building out (a "find my existing story note" lookup, CSV/timeline
 * variants, ...) before investing in any of that. */
export function StoryButton({ view, detail, onAttached }: { view: ViewConfig; detail: ObjectDetail; onAttached: () => void }) {
  const [spec, setSpec] = useState<StorySpec | null>(null);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (view.key !== "person" || !hasPermissions("AddObject", "EditObject")) return null;

  const label = "Generate a story from this person's events";

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const personName = summaryLine("person", detail) || "this person";
      const [visualData, token] = await Promise.all([loadVisualData(), getToken()]);
      const built = await buildPersonStory(token, detail, personName, visualData);
      if (!built) {
        setError("This person has no events to build a story from.");
        return;
      }
      const noteHandle = await createStoryNote(token, built);
      await attachNoteToObject(token, view, detail.handle, noteHandle);
      onAttached();
      setSpec(built);
      setOpened(true);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Tooltip label={error ?? label} withArrow color={error ? "red" : undefined}>
        <UnstyledButton onClick={handleClick} disabled={busy} aria-label={label}>
          <Text size="lg" lh={1}>🗺️</Text>
        </UnstyledButton>
      </Tooltip>
      <StoryView spec={spec} opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}
