// Structured replacement for ObjectEditDialog.tsx's old raw-JSON textarea
// ("json" field kind) -- a story is just a title plus a list of slides, so
// this exposes exactly that: one card per point with Event/Media pickers,
// its own heading, and a lightly-stylable text field, plus add/remove/
// reorder controls and a Preview button that opens the real StoryView on
// the in-progress spec. Title and text are the two fields a generated
// story seeds and then hands over (storyText.ts) -- everything else on a
// slide stays a reference that's re-resolved at presentation time.
import { useEffect, useState } from "react";
import { Button, Card, Group, Stack, Text, TextInput } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchPage } from "../../store/api";
import { EVENT_VIEW, MEDIA_VIEW } from "../../store/views";
import type { StoryPoint, StorySpec } from "../../store/storyBuilder";
import { CircleGlyphButton } from "../CircleGlyphButton";
import { RefSlot, pickerResultLabel } from "../RefPickerField";
import { StoryTextField } from "./StoryTextField";
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
          onChange={(text) => onUpdate({ text: text || undefined })}
        />
      </Stack>
    </Card>
  );
}

export function StoryEditor({ spec, onChange, previewStackId }: {
  spec: StorySpec; onChange: (spec: StorySpec) => void;
  /** Forwarded to StoryView's own `stackId` so the Preview modal registers
   * with the surrounding edit dialog's Modal.Stack and renders above it,
   * not beneath (see StoryView.tsx's own doc comment on that prop). */
  previewStackId: string;
}) {
  const [labels, setLabels] = useRefLabels(spec);
  const [previewOpened, setPreviewOpened] = useState(false);

  function updatePoint(index: number, patch: Partial<StoryPoint>) {
    onChange({ ...spec, points: spec.points.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  }
  function removePoint(index: number) {
    onChange({ ...spec, points: spec.points.filter((_, i) => i !== index) });
  }
  function movePoint(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= spec.points.length) return;
    const points = [...spec.points];
    [points[index], points[target]] = [points[target], points[index]];
    onChange({ ...spec, points });
  }
  function addPoint() {
    onChange({ ...spec, points: [...spec.points, {}] });
  }

  return (
    <Stack gap="sm">
      <TextInput
        label={t("Title")}
        value={spec.title}
        onChange={(e) => onChange({ ...spec, title: e.currentTarget.value })}
      />
      {spec.points.map((point, i) => (
        <StorySlideCard
          key={i}
          point={point}
          index={i}
          total={spec.points.length}
          labels={labels}
          onLabel={(handle, label) => setLabel(setLabels, handle, label)}
          onUpdate={(patch) => updatePoint(i, patch)}
          onRemove={() => removePoint(i)}
          onMoveUp={() => movePoint(i, -1)}
          onMoveDown={() => movePoint(i, 1)}
        />
      ))}
      <Group justify="space-between">
        <CircleGlyphButton glyph="+" label={t("Add slide")} textLabel="Add slide" onClick={addPoint} />
        <Button variant="default" size="xs" onClick={() => setPreviewOpened(true)} disabled={spec.points.length === 0}>
          {t("Preview")}
        </Button>
      </Group>
      <StoryView
        spec={spec.points.length > 0 ? spec : null}
        opened={previewOpened}
        onClose={() => setPreviewOpened(false)}
        stackId={previewStackId}
      />
    </Stack>
  );
}
