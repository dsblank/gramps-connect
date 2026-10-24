// Structured replacement for ObjectEditDialog.tsx's old raw-JSON textarea
// ("json" field kind) -- a story is just a title plus a list of slides, laid
// out like the story package's file editor: the slide list on the left
// (pick a slide, drag to reorder), the picked slide's fields (or the
// story's own) in the middle, and the real player on the right following
// the story as it's edited (StoryView.tsx's StoryPreview). Undo/Redo step
// back through changes made since the dialog opened; Present plays the
// story full screen from the slide being edited. The controls and the undo
// history are shared with the package's editor, but the slides here stay
// references: title and text are the two fields a generated story seeds
// and then hands over (storyText.ts) -- everything else on a slide is
// re-resolved from its event and photo at presentation time.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActionIcon, Box, Button, Divider, Group, Stack, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  record, redo, SlideList, startHistory, StoryTextField, undo, type History,
} from "@gramps-connect/story/editor";
import { getToken } from "../../auth/auth";
import { fetchPage, type QueryItem } from "../../store/api";
import { EVENT_VIEW, MEDIA_VIEW } from "../../store/views";
import { pointPhotos, withPhotos, type StoryPoint, type StorySpec } from "../../store/storyBuilder";
import { RefSlot, pickerResultLabel } from "../RefPickerField";
import { MediaThumbnail } from "../related/MediaThumbnail";
import { StoryPreview, StoryView } from "../StoryView";
import { refInfo, StoryPhotosField, type RefInfo } from "./StoryPhotosField";
import { t } from "../../i18n/i18n";

/** The story's own settings, in place of a slide index. */
const STORY = -1;

/** Resolves display labels for every eventRef/mediaRef already on `spec`
 * that this component hasn't seen yet -- same `fetchPage(view, token, null,
 * false, 'handle == "<h>"')` + pickerResultLabel(type, item) pattern
 * ObjectEditDialog.tsx's own label-resolution effect uses for its
 * reference/refList/mediaList fields (lines 305-340 there), kept as its own
 * copy here since this is the only consumer of these particular refs. */
function useRefInfo(spec: StorySpec) {
  const [info, setInfo] = useState<Record<string, RefInfo>>({});
  useEffect(() => {
    const pending: { handle: string; type: "event" | "media" }[] = [];
    for (const p of spec.points) {
      if (p.eventRef && !(p.eventRef in info)) pending.push({ handle: p.eventRef, type: "event" });
      for (const photo of pointPhotos(p)) if (!(photo in info)) pending.push({ handle: photo, type: "media" });
    }
    if (pending.length === 0) return;
    (async () => {
      const token = await getToken();
      for (const { handle, type } of pending) {
        const { page } = await fetchPage(type === "event" ? EVENT_VIEW : MEDIA_VIEW, token, null, false, `handle == "${handle}"`);
        const item = page.items[0];
        if (item) setInfo((prev) => ({ ...prev, [handle]: refInfo(type, item) }));
      }
    })();
    // `info` deliberately excluded -- same reasoning as
    // ObjectEditDialog.tsx's identical effect (FamilyEditDialog.tsx has the
    // fuller doc comment on why).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.points]);
  return [info, setInfo] as const;
}

/** A slide's row in the list: its photo, its title (else its event), and
 * below, "Opening slide" or its event when it has a title of its own. */
function SlideRow({ point, index, info }: { point: StoryPoint; index: number; info: Record<string, RefInfo> }) {
  const event = point.eventRef ? info[point.eventRef]?.label : undefined;
  const name = point.title || event;
  const first = pointPhotos(point)[0];
  const photo = first ? info[first] : undefined;
  return (
    <Group gap="sm" wrap="nowrap">
      <Box
        w={40} h={40}
        style={{ flex: "none", borderRadius: 4, background: "var(--mantine-color-default-hover)", overflow: "hidden" }}
      >
        {first && photo && <MediaThumbnail handle={first} mime={photo.mime} size={40} />}
      </Box>
      <Box style={{ minWidth: 0 }}>
        <Text size="sm" fw={500} truncate dir="auto" c={name ? undefined : "dimmed"}>
          {name || t("Untitled slide")}
        </Text>
        <Text size="xs" c="dimmed" truncate dir="auto">
          {index === 0 ? t("Opening slide") : point.title ? (event ?? "") : ""}
        </Text>
      </Box>
    </Group>
  );
}

export function StoryEditor({ spec, onChange, previewStackId }: {
  spec: StorySpec; onChange: (spec: StorySpec) => void;
  /** Forwarded to StoryView's own `stackId` so the Present modal registers
   * with the surrounding edit dialog's Modal.Stack and renders above it,
   * not beneath (see StoryView.tsx's own doc comment on that prop). */
  previewStackId: string;
}) {
  // The spec as of each change since the dialog opened; `spec` is only the
  // starting point, as the parent re-parses it from the note every render.
  const [history, setHistory] = useState(() => startHistory(spec));
  const historyRef = useRef(history);
  const current = history.present;
  const [info, setInfo] = useRefInfo(current);
  const [presenting, setPresenting] = useState(false);
  const [selected, setSelected] = useState(0);
  const wide = useMediaQuery("(min-width: 1000px)", true);
  const index = selected === STORY ? STORY : Math.min(selected, current.points.length - 1);
  const point = index >= 0 ? current.points[index] : undefined;
  const total = current.points.length;

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
  // text field, which has its own. Not from Present, whose keys reach here
  // through its portal.
  function onKeyDown(e: KeyboardEvent) {
    if (presenting || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) { e.preventDefault(); show(undo(historyRef.current)); }
    else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); show(redo(historyRef.current)); }
  }

  function updatePoint(index: number, patch: Partial<StoryPoint>) {
    const typed = "title" in patch ? "title" : "text" in patch ? "text" : undefined;
    change({ ...current, points: current.points.map((p, i) => (i === index ? { ...p, ...patch } : p)) }, typed && `${index}:${typed}`);
  }
  /** Photos added to slide `index` as it is now (see StoryPhotosField's
   * onAdd), each at most once. */
  function addPhotos(index: number, handles: string[]) {
    const latest = historyRef.current.present;
    const target = latest.points[index];
    if (!target) return;
    const photos = pointPhotos(target);
    const fresh = handles.filter((h, i) => !photos.includes(h) && handles.indexOf(h) === i);
    if (!fresh.length) return;
    change({ ...latest, points: latest.points.map((p, i) => (i === index ? withPhotos(p, [...photos, ...fresh]) : p)) });
  }
  function removePoint(index: number) {
    change({ ...current, points: current.points.filter((_, i) => i !== index) });
    setSelected(Math.max(0, index - 1));
  }
  function movePoint(from: number, to: number) {
    if (from === to || to < 0 || to >= total) return;
    const points = [...current.points];
    const [moved] = points.splice(from, 1);
    points.splice(to, 0, moved);
    change({ ...current, points });
    setSelected(to);
  }
  /** A new slide (or a copy of `copy`) right after the one being edited,
   * or at the end from the story's settings. */
  function insertPoint(slide: StoryPoint = {}) {
    const at = index === STORY ? total : index + 1;
    change({ ...current, points: [...current.points.slice(0, at), slide, ...current.points.slice(at)] });
    setSelected(at);
  }
  function remember(type: "event" | "media", item: QueryItem) {
    setInfo((prev) => ({ ...prev, [item.handle]: refInfo(type, item) }));
  }

  const storyForm = (
    <Stack gap="md">
      <Text fw={600} size="lg">{t("Story")}</Text>
      <TextInput
        label={t("Title")} required value={current.title}
        onChange={(e) => change({ ...current, title: e.currentTarget.value }, "title")}
      />
    </Stack>
  );

  const slideForm = point && (
    <Stack gap="md" key={index}>
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text fw={600} size="lg">{index === 0 ? t("Opening slide") : `${index + 1} / ${total}`}</Text>
        <Group gap={6}>
          <Tooltip label={t("Move up")}>
            <ActionIcon variant="default" aria-label={t("Move up")} disabled={index === 0} onClick={() => movePoint(index, index - 1)}>↑</ActionIcon>
          </Tooltip>
          <Tooltip label={t("Move down")}>
            <ActionIcon variant="default" aria-label={t("Move down")} disabled={index === total - 1} onClick={() => movePoint(index, index + 1)}>↓</ActionIcon>
          </Tooltip>
          <Button variant="default" size="xs" onClick={() => insertPoint({ ...point })}>{t("Duplicate")}</Button>
          <Button variant="default" size="xs" color="red" disabled={total <= 1} onClick={() => removePoint(index)}>{t("Delete")}</Button>
        </Group>
      </Group>
      <TextInput
        label={t("Title")}
        placeholder={t("Defaults to the event's own type")}
        value={point.title ?? ""}
        onChange={(e) => updatePoint(index, { title: e.currentTarget.value || undefined })}
      />
      <RefSlot
        label={t("Event")}
        handle={point.eventRef ?? null}
        pickedLabel={point.eventRef ? (info[point.eventRef]?.label ?? null) : null}
        onPick={(item) => {
          remember("event", item);
          updatePoint(index, { eventRef: item.handle });
        }}
        onRemovePicked={() => updatePoint(index, { eventRef: undefined })}
        view={EVENT_VIEW}
        searchField="description"
        buildExpr={EVENT_VIEW.simpleSearch?.buildExpr}
        placeholder={EVENT_VIEW.simpleSearch?.placeholder}
        renderLabel={(item) => pickerResultLabel("event", item)}
      />
      <StoryTextField
        label={t("Text")}
        value={point.text ?? ""}
        boldLabel={t("Bold")}
        italicLabel={t("Italic")}
        minRows={5}
        onChange={(text) => updatePoint(index, { text: text || undefined })}
      />
      <StoryPhotosField
        photos={pointPhotos(point)}
        info={info}
        onChange={(photos) => change({ ...current, points: current.points.map((p, i) => (i === index ? withPhotos(p, photos) : p)) })}
        onAdd={(handles) => addPhotos(index, handles)}
        onPicked={(item) => remember("media", item)}
      />
    </Stack>
  );

  const list = (
    <Stack gap="xs">
      <UnstyledButton
        onClick={() => setSelected(STORY)}
        style={{ padding: 8, borderRadius: 6, background: index === STORY ? "var(--mantine-primary-color-light)" : undefined }}
      >
        <Text fw={600} size="sm">{t("Story")}</Text>
        <Text size="xs" c="dimmed">{t("Title")}</Text>
      </UnstyledButton>
      <Divider label={t("Slides")} labelPosition="left" />
      <SlideList
        label={t("Slides")}
        items={current.points}
        selected={index}
        onSelect={setSelected}
        onMove={movePoint}
        getKey={(_, i) => String(i)}
        renderItem={(p, i) => <SlideRow point={p} index={i} info={info} />}
      />
      <Button variant="light" size="xs" mt={4} onClick={() => insertPoint()}>
        + {t("Add slide")}
      </Button>
    </Stack>
  );

  // The story at the slide being edited (its first, from the settings).
  const preview = (
    <Box
      style={{
        position: wide ? "sticky" : "relative", top: 0, height: wide ? "min(70vh, 640px)" : 420,
        borderRadius: 8, overflow: "hidden", border: "1px solid var(--mantine-color-default-border)",
      }}
    >
      {total > 0 ? (
        <StoryPreview
          spec={current}
          slide={index === STORY ? 0 : index}
          onSlideChange={(i) => { if (i !== index && index !== STORY) setSelected(i); }}
        />
      ) : (
        <Stack align="center" justify="center" style={{ height: "100%" }}>
          <Text size="sm" c="dimmed">{t("Add a slide to see the story here.")}</Text>
        </Stack>
      )}
    </Box>
  );

  return (
    <Stack gap="sm" onKeyDown={onKeyDown}>
      <Group
        gap="sm" wrap="nowrap" justify="space-between" pb="xs"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Text fw={600} truncate dir="auto">{current.title}</Text>
        <Group gap="xs" wrap="nowrap">
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
          <Button variant="default" onClick={() => setPresenting(true)} disabled={total === 0}>
            {t("Present")}
          </Button>
        </Group>
      </Group>
      <Box style={{ display: "flex", flexDirection: wide ? "row" : "column", gap: 16, alignItems: "flex-start" }}>
        <Box style={{ width: wide ? 260 : "100%", flex: "none" }}>{list}</Box>
        <Box style={{ width: wide ? "min(480px, 36%)" : "100%", flex: "none", minWidth: 0 }}>
          {index === STORY ? storyForm : slideForm}
        </Box>
        <Box style={{ flex: 1, minWidth: 0, width: wide ? undefined : "100%", alignSelf: "stretch" }}>{preview}</Box>
      </Box>
      <StoryView
        spec={total > 0 ? current : null}
        opened={presenting}
        onClose={() => setPresenting(false)}
        initialSlide={index === STORY ? 0 : index}
        stackId={previewStackId}
      />
    </Stack>
  );
}
