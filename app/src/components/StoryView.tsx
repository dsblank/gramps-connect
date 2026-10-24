// Present: a story, fullscreen, through @gramps-connect/story's player --
// the same player a downloaded .story.zip opens in, so what Present shows
// is exactly what a download can carry. This file is just the host: it
// hydrates the stored spec (storyHydration.ts), converts it to a story
// document (storyDoc.ts's presentationDoc), and gives the player what only
// the app has -- authenticated media, the app's colors and words, and its
// own Mantine map-mode control. StoryPreview is the same player inline,
// following a story as it's edited (StoryEditor.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Box, Loader, Modal, Stack, Text, useComputedColorScheme } from "@mantine/core";
// Namespace import: maplibre-gl v5+ has no default export.
import * as maplibregl from "maplibre-gl";
import { StoryPlayer } from "@gramps-connect/story/player";
import type { MediaItem } from "@gramps-connect/story";
import { getToken } from "../auth/auth";
import { fetchAuthedBlobUrl } from "../store/authedFetch";
import type { StorySpec } from "../store/storyBuilder";
import { parsePresentationMediaSrc, presentationDoc } from "../store/storyDoc";
import { hydrateStory, hydrationCache, type HydratedStory } from "../store/storyHydration";
import { readVisualColors } from "./visuals/cssVar";
import { seriesColor } from "./visuals/eventCategories";
import { MapModeControl } from "./visuals/MapModeControl";
import { storyWords } from "./story/storyStrings";

// Where the map's worker script is served -- without it the basemap draws
// nothing at all. The player can't know a host's file layout, so each host
// sets this; see MapCanvas.tsx for why it's a fixed public/ path here.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

/** Hydrates `spec` while the presentation is open -- see storyHydration.ts.
 * Real async work (the event/place cache, a mime fetch per photo, each map
 * file), so callers see null until it resolves. */
function useHydratedStory(spec: StorySpec | null, opened: boolean): HydratedStory | null {
  const [hydrated, setHydrated] = useState<HydratedStory | null>(null);
  useEffect(() => {
    setHydrated(null);
    if (!spec || !opened) return;
    let cancelled = false;
    hydrateStory(spec).then((h) => {
      if (!cancelled) setHydrated(h);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [spec, opened]);
  return hydrated;
}

/** Fetches each media file the player asks for once, with the token in a
 * header rather than the URL (fetchAuthedBlobUrl), and revokes every blob
 * URL when the presentation closes. A photo comes as a 1200px thumbnail;
 * a map overlay as its original file, which keeps its transparency. */
function useTreeMediaResolver(opened: boolean) {
  const cache = useRef(new Map<string, Promise<string | null>>());

  useEffect(() => {
    if (opened) return;
    const pending = [...cache.current.values()];
    cache.current.clear();
    for (const url of pending) url.then((u) => u && URL.revokeObjectURL(u));
  }, [opened]);
  useEffect(() => () => {
    for (const url of cache.current.values()) url.then((u) => u && URL.revokeObjectURL(u));
  }, []);

  return useCallback((_key: string, item: MediaItem): Promise<string | null> => {
    const parsed = parsePresentationMediaSrc(item.src);
    if (!parsed) return Promise.resolve(null);
    let url = cache.current.get(item.src);
    if (!url) {
      const path = parsed.purpose === "photo"
        ? `/api/media/${encodeURIComponent(parsed.handle)}/thumbnail/1200`
        : `/api/media/${encodeURIComponent(parsed.handle)}/file`;
      url = getToken().then((token) => fetchAuthedBlobUrl(path, token)).catch(() => null);
      cache.current.set(item.src, url);
    }
    return url;
  }, []);
}

/** What the player gets from the app wherever it plays: the app's dark
 * mode, colors and words, and its map-mode control. */
function useAppPlayerProps() {
  const dark = useComputedColorScheme("light") === "dark";
  // Resolved from the app's theme on each render, since they change under
  // the user when the color scheme flips.
  const visual = readVisualColors();
  const colors = useMemo(
    () => ({ ...visual, mark: seriesColor(dark) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dark, visual.surface, visual.text, visual.muted, visual.border],
  );
  // In the app's language, not the story's (story/storyStrings.ts).
  const strings = storyWords().player;
  return { dark, colors, strings, renderMapModeControl: renderMapMode };
}

function renderMapMode(props: Parameters<typeof MapModeControl>[0]) {
  return <MapModeControl {...props} words={storyWords().player} />;
}

/** How long typing pauses before the preview catches up. */
const PREVIEW_DELAY_MS = 400;

/** The story playing inline, as it's edited: re-hydrated a moment after
 * each change, with what it fetched (photos' types, map files) kept for
 * the next time, and the last version shown meanwhile. Shows slide
 * `slide`; moving through the player's own controls calls onSlideChange. */
export function StoryPreview({ spec, slide, onSlideChange }: {
  spec: StorySpec; slide: number; onSlideChange: (index: number) => void;
}) {
  const player = useAppPlayerProps();
  const resolveMedia = useTreeMediaResolver(true);
  const cache = useRef(hydrationCache());
  // The spec each hydration was made from, to tell a current one.
  const [hydrated, setHydrated] = useState<{ spec: StorySpec; story: HydratedStory } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      hydrateStory(spec, cache.current).then((story) => {
        if (!cancelled) setHydrated({ spec, story });
      }).catch(() => {});
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spec]);
  const story = useMemo(() => (hydrated ? presentationDoc(hydrated.story) : null), [hydrated]);
  const current = hydrated?.spec === spec;

  if (!story) {
    return (
      <Stack align="center" justify="center" style={{ height: "100%" }}>
        <Loader size="sm" />
      </Stack>
    );
  }
  return (
    <StoryPlayer
      {...player}
      story={story}
      resolveMedia={resolveMedia}
      keyboard={false}
      initialSlide={slide}
      // Only once caught up: a story that's behind (a slide just added
      // isn't in it yet) would move the editor to one of its own slides.
      onSlideChange={(i) => { if (current) onSlideChange(i); }}
    />
  );
}

export function StoryView({ spec, opened, onClose, stackId, initialSlide }: {
  spec: StorySpec | null; opened: boolean; onClose: () => void;
  /** The slide to open on (StoryEditor's Present: the one being edited). */
  initialSlide?: number;
  /** Only set when opened from inside another Mantine Modal.Stack (see
   * StoryEditor.tsx's Preview button) -- without it, this plain unstacked
   * Modal defaults to the same base z-index as the dialog it's nested
   * inside, and renders *underneath* it rather than on top (Modal.mjs only
   * asks the stack for a z-index/focus-trap/overlay when both a `stackId`
   * and a surrounding Modal.Stack context are present). StoryActions.tsx's
   * standalone Present button (no surrounding stack) leaves this unset. */
  stackId?: string;
}) {
  const player = useAppPlayerProps();
  const hydrated = useHydratedStory(spec, opened);
  const story = useMemo(() => (hydrated ? presentationDoc(hydrated) : null), [hydrated]);
  const resolveMedia = useTreeMediaResolver(opened);

  if (!spec) return null;

  return (
    <Modal
      opened={opened} onClose={onClose} fullScreen withCloseButton={false} stackId={stackId}
      styles={{ body: { padding: 0 } }}
    >
      {/* position: fixed, not a percentage height: Mantine's modal body
          isn't a sized flex child, so anything else either overflows the
          viewport or collapses. */}
      <Box style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
        {story ? (
          <StoryPlayer
            {...player}
            story={story}
            resolveMedia={resolveMedia}
            initialSlide={initialSlide}
            onClose={onClose}
          />
        ) : (
          <Stack align="center" justify="center" style={{ height: "100%" }}>
            <Loader />
            <ActionIcon
              variant="filled" color="dark" size={36} radius="xl" onClick={onClose} aria-label={storyWords().player.close}
              style={{ position: "absolute", top: 10, right: 12, opacity: 0.8 }}
            >
              <Text size="lg" c="white">×</Text>
            </ActionIcon>
          </Stack>
        )}
      </Box>
    </Modal>
  );
}
