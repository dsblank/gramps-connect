// Structured replacement for ObjectEditDialog.tsx's old raw-JSON textarea
// ("json" field kind) -- a story is just a title plus a list of slides, so
// this exposes exactly that: the story package's slide list (pick a slide,
// drag to reorder) beside the picked slide's card with Event/Media pickers,
// its own heading, and the package's text field, plus add/remove/reorder
// controls and a Preview button that opens the real StoryView on the
// in-progress spec. Undo/Redo step back through changes made since the
// dialog opened. The controls (and the undo history) are shared with the
// package's file editor; the slides here stay references. Title and text are the two fields a generated
// story seeds and then hands over (storyText.ts) -- everything else on a
// slide stays a reference that's re-resolved at presentation time.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActionIcon, Box, Button, Card, Grid, Group, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import {
  record, redo, SlideList, startHistory, StoryTextField, undo, type History,
} from "@gramps-connect/story/editor";
import { getToken } from "../../auth/auth";
import { fetchPage } from "../../store/api";
import { EVENT_VIEW, MEDIA_VIEW } from "../../store/views";
import type { StoryPoint, StorySpec } from "../../store/storyBuilder";
import { CircleGlyphButton } from "../CircleGlyphButton";
import { RefSlot, pickerResultLabel } from "../RefPickerField";
import { StoryView } from "../StoryView";
import { t } from "../../i18n/i18n";

/** Resolves display labels for every eventRef/mediaRef already on `spec`
 * that this component hasn't seen yet -- same `fetchPage(view, token, null,
 * false, 'handle == "<h>"')` + pickerResultLabel(type, item) pattern
 * ObjectEditDialog.tsx's own label-resolution effect uses for its
 * reference/refList/mediaList fields (lines 305-340 there), kept as its own
 * copy here since this is the only consumer of these particular refs. */
function useRefLabels(spec: StorySpec) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    const pending: { handle: string; type: "event" | "media" }[] = [];
    for (const p of spec.points) {
      if (p.eventRef && !(p.eventRef in labels)) pending.push({ handle: p.eventRef, type: "event" });
      if (p.mediaRef && !(p.mediaRef in labels)) pending.push({ handle: p.mediaRef, type: "media" });
    }
    if (pending.length === 0) return;
    (async () => {
      const token = await getToken();
      for (const { handle, type } of pending) {
        const { page } = await fetchPage(type === "event" ? EVENT_VIEW : MEDIA_VIEW, token, null, false, `handle == "${handle}"`);
        const item = page.items[0];
        if (item) setLabels((prev) => ({ ...prev, [handle]: pickerResultLabel(type, item) }));
      }
    })();
    // `labels` deliberately excluded -- same reasoning as
    // ObjectEditDialog.tsx's identical effect (FamilyEditDialog.tsx has the
    // fuller doc comment on why).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.points]);
  return [labels, setLabels] as const;
}

function setLabel(setLabels: (fn: (prev: Record<string, string>) => Record<string, string>) => void, handle: string, label: string) {
  setLabels((prev) => ({ ...prev, [handle]: label }));
}

interface StorySlideCardProps {
  point: StoryPoint;
  index: number;
  total: number;
  labels: Record<string, string>;
  onLabel: (handle: string, label: string) => void;
  onUpdate: (patch: Partial<StoryPoint>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function StorySlideCard({ point, index, total, labels, onLabel, onUpdate, onRemove, onMoveUp, onMoveDown }: StorySlideCardProps) {
  return (
    <Card withBorder padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={600}>Slide {index + 1}</Text>
          <Group gap={4} wrap="nowrap">
            {index > 0 && <CircleGlyphButton glyph="↑" label={t("Move up")} onClick={onMoveUp} size={20} />}
            {index < total - 1 && <CircleGlyphButton glyph="↓" label={t("Move down")} onClick={onMoveDown} size={20} />}
            <CircleGlyphButton glyph="−" label={t("Remove slide")} onClick={onRemove} size={20} />
          </Group>
        </Group>
        <RefSlot
          label={t("Event")}
          handle={point.eventRef ?? null}
          pickedLabel={point.eventRef ? (labels[point.eventRef] ?? null) : null}
          onPick={(item) => {
            onLabel(item.handle, pickerResultLabel("event", item));
            onUpdate({ eventRef: item.handle });
          }}
          onRemovePicked={() => onUpdate({ eventRef: undefined })}
          view={EVENT_VIEW}
          searchField="description"
          buildExpr={EVENT_VIEW.simpleSearch?.buildExpr}
          placeholder={EVENT_VIEW.simpleSearch?.placeholder}
          renderLabel={(item) => pickerResultLabel("event", item)}
        />
        <RefSlot
          label={t("Media")}
          handle={point.mediaRef ?? null}
          pickedLabel={point.mediaRef ? (labels[point.mediaRef] ?? null) : null}
          onPick={(item) => {
            onLabel(item.handle, pickerResultLabel("media", item));
            onUpdate({ mediaRef: item.handle });
          }}
          onRemovePicked={() => onUpdate({ mediaRef: undefined })}
          view={MEDIA_VIEW}
          searchField="desc"
          buildExpr={MEDIA_VIEW.simpleSearch?.buildExpr}
          placeholder={MEDIA_VIEW.simpleSearch?.placeholder}
          renderLabel={(item) => pickerResultLabel("media", item)}
        />
        <TextInput
          label={t("Title")}
          placeholder={t("Defaults to the event's own type")}
          value={point.title ?? ""}
          onChange={(e) => onUpdate({ title: e.currentTarget.value || undefined })}
        />
        <StoryTextField
          label={t("Text")}
          value={point.text ?? ""}
          boldLabel={t("Bold")}
          italicLabel={t("Italic")}
          minRows={5}
          onChange={(text) => onUpdate({ text: text || undefined })}
        />
      </Stack>
    </Card>
  );
}

/** A slide's row in the list: its title, else its event's label. */
function SlideRow({ point, index, labels }: { point: StoryPoint; index: number; labels: Record<string, string> }) {
  const name = point.title || (point.eventRef ? labels[point.eventRef] : undefined);
  const media = point.mediaRef ? labels[point.mediaRef] : undefined;
  return (
    <Box style={{ minWidth: 0 }}>
      <Text size="sm" fw={500} truncate dir="auto" c={name ? undefined : "dimmed"}>
        {index + 1}. {name || t("Untitled slide")}
      </Text>
      <Text size="xs" c="dimmed" truncate dir="auto">{media ?? point.text ?? ""}</Text>
    </Box>
  );
}

export function StoryEditor({ spec, onChange, previewStackId }: {
  spec: StorySpec; onChange: (spec: StorySpec) => void;
  /** Forwarded to StoryView's own `stackId` so the Preview modal registers
   * with the surrounding edit dialog's Modal.Stack and renders above it,
   * not beneath (see StoryView.tsx's own doc comment on that prop). */
  previewStackId: string;
}) {
  // The spec as of each change since the dialog opened; `spec` is only the
  // starting point, as the parent re-parses it from the note every render.
  const [history, setHistory] = useState(() => startHistory(spec));
  const historyRef = useRef(history);
  const current = history.present;
  const [labels, setLabels] = useRefLabels(current);
  const [previewOpened, setPreviewOpened] = useState(false);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, current.points.length - 1);
  const point = index >= 0 ? current.points[index] : undefined;

  // Every change goes through here, into the history and to the parent.
  // Typing in the same field makes one undo step (see `key`).
  function change(next: StorySpec, key?: string) {
    show(record(historyRef.current, next, key));
  }
  function show(next: History<StorySpec>) {
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    onChange(next.present);
  }
  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) anywhere in the editor, except in a
  // text field, which has its own. Not from the Preview, whose keys reach
  // here through its portal.
  function onKeyDown(e: KeyboardEvent) {
    if (previewOpened || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) { e.preventDefault(); show(undo(historyRef.current)); }
    else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); show(redo(historyRef.current)); }
  }

  function updatePoint(index: number, patch: Partial<StoryPoint>) {
    const typed = "title" in patch ? "title" : "text" in patch ? "text" : undefined;
    change({ ...current, points: current.points.map((p, i) => (i === index ? { ...p, ...patch } : p)) }, typed && `${index}:${typed}`);
  }
  function removePoint(index: number) {
    change({ ...current, points: current.points.filter((_, i) => i !== index) });
    setSelected(Math.max(0, index - 1));
  }
  function movePoint(from: number, to: number) {
    if (from === to || to < 0 || to >= current.points.length) return;
    const points = [...current.points];
    const [moved] = points.splice(from, 1);
    points.splice(to, 0, moved);
    change({ ...current, points });
    setSelected(to);
  }
  function addPoint() {
    // After the slide being edited, as in the story package's editor.
    const at = index + 1;
    change({ ...current, points: [...current.points.slice(0, at), {}, ...current.points.slice(at)] });
    setSelected(at);
  }

  return (
    <Stack gap="sm" onKeyDown={onKeyDown}>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          label={t("Title")}
          value={current.title}
          onChange={(e) => change({ ...current, title: e.currentTarget.value }, "title")}
          style={{ flex: 1 }}
        />
        <Tooltip label={t("Undo")}>
          <ActionIcon variant="default" size="lg" aria-label={t("Undo")} disabled={history.past.length === 0} onClick={() => show(undo(historyRef.current))}>
            ↶
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("Redo")}>
          <ActionIcon variant="default" size="lg" aria-label={t("Redo")} disabled={history.future.length === 0} onClick={() => show(redo(historyRef.current))}>
            ↷
          </ActionIcon>
        </Tooltip>
      </Group>
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, sm: 4, lg: 3 }}>
          <Stack gap="xs">
            <SlideList
              label={t("Slides")}
              items={current.points}
              selected={index}
              onSelect={setSelected}
              onMove={movePoint}
              getKey={(_, i) => String(i)}
              renderItem={(p, i) => <SlideRow point={p} index={i} labels={labels} />}
            />
            <Group justify="space-between">
              <CircleGlyphButton glyph="+" label={t("Add slide")} textLabel="Add slide" onClick={addPoint} />
              <Button variant="default" size="xs" onClick={() => setPreviewOpened(true)} disabled={current.points.length === 0}>
                {t("Preview")}
              </Button>
            </Group>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 8, lg: 9 }}>
          {point && (
            <StorySlideCard
              key={index}
              point={point}
              index={index}
              total={current.points.length}
              labels={labels}
              onLabel={(handle, label) => setLabel(setLabels, handle, label)}
              onUpdate={(patch) => updatePoint(index, patch)}
              onRemove={() => removePoint(index)}
              onMoveUp={() => movePoint(index, index - 1)}
              onMoveDown={() => movePoint(index, index + 1)}
            />
          )}
        </Grid.Col>
      </Grid>
      <StoryView
        spec={current.points.length > 0 ? current : null}
        opened={previewOpened}
        onClose={() => setPreviewOpened(false)}
        stackId={previewStackId}
      />
    </Stack>
  );
}
