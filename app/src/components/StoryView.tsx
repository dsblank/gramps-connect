// Pilot: renders a StorySpec (storyBuilder.ts) as a fullscreen sequence of
// cards, one slide per point (plus a synthetic opening slide built from
// spec.title/intro). Each slide shows whichever of person/place/date/photo
// that point actually has -- nothing here assumes all four, or any one of
// them, are present.
//
// Two layouts, chosen once per story (not per slide) by whether *any* point
// has a location: a located story gets the full-bleed map background
// (StoryMapBackground) with the slide content overlaid in a side panel and
// large edge nav arrows, modeled on a Knight Lab StoryMapJS slide; an
// unlocated story keeps the plain centered card this pilot started with.
// Both layouts share the same slide-content and nav-arrow building blocks
// (StorySlideContent, NavArrows) so the two aren't really "different
// components" so much as different arrangements of the same pieces -- and
// both get the timeline strip appended when the story has enough dated
// points to make one meaningful.
import { useEffect, useState } from "react";
import { ActionIcon, Box, Group, Image, Loader, Modal, Paper, Stack, Text, useComputedColorScheme } from "@mantine/core";
import { getToken } from "../auth/auth";
import { API_BASE } from "../config";
import { StoryMapBackground } from "./story/StoryMapBackground";
import { StoryTimelineStrip, type StoryTimelinePoint } from "./story/StoryTimelineStrip";
import type { StorySpec } from "../store/storyBuilder";
import { hydrateStory, type HydratedSlide } from "../store/storyHydration";

// Width of the content panel (and, matching it, how much of the map's
// right side StoryMapBackground pads out) -- kept as one constant so the
// two stay in step: widening the panel to push the fade zone further left
// without updating the map's own padding would leave the map's "centered
// point" off-centre in the now-narrower clear area.
const PANEL_FRACTION = 0.62;

function isLocated(p: HydratedSlide): p is HydratedSlide & { lat: number; long: number } {
  return p.lat != null && p.long != null;
}

// Matches StoryTextField.tsx's own markers -- `**bold**` before `*italic*`
// so a bold span's own `**` pair isn't misread as two empty italic spans.
const STYLE_MARKERS = /\*\*(.+?)\*\*|\*(.+?)\*/g;

/** Turns StoryTextField.tsx's `**bold**`/`*italic*` markers into `<b>`/`<i>`
 * spans -- deliberately just these two, matching that field's own toolbar;
 * anything else (literal asterisks, unmatched markers) passes through as
 * plain text. */
function renderStoryText(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = STYLE_MARKERS.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) nodes.push(<b key={key++}>{match[1]}</b>);
    else nodes.push(<i key={key++}>{match[2]}</i>);
    last = STYLE_MARKERS.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Resolves `spec`'s refs into display data every time it changes -- see
 * storyHydration.ts. Runs real async work (a visualData load plus one mime
 * fetch per distinct photo), so callers see `null` until it resolves. */
function useHydratedStory(spec: StorySpec | null) {
  const [hydrated, setHydrated] = useState<Awaited<ReturnType<typeof hydrateStory>> | null>(null);
  useEffect(() => {
    if (!spec) {
      setHydrated(null);
      return;
    }
    let cancelled = false;
    setHydrated(null);
    hydrateStory(spec).then((h) => {
      if (!cancelled) setHydrated(h);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [spec]);
  return hydrated;
}

/** Full-bleed authed photo -- same jwt-query-param trick as
 * MediaThumbnail.tsx (an <img> can't carry an Authorization header), just
 * sized for a slide rather than a fixed inline square. */
function SlidePhoto({ handle, mime }: { handle: string; mime?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!mime?.startsWith("image/")) return;
    let cancelled = false;
    getToken().then((token) => {
      if (!cancelled) setSrc(`${API_BASE}/api/media/${encodeURIComponent(handle)}/thumbnail/1200?jwt=${encodeURIComponent(token)}`);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [handle, mime]);
  if (!src) return null;
  return <Image src={src} alt="" fit="contain" style={{ maxHeight: "42vh", maxWidth: "100%" }} radius="sm" />;
}

/** The one piece of UI that actually knows what a slide is (photo, eyebrow
 * line, title, body) -- reused verbatim by both layouts below, which differ
 * only in where they place it. */
function StorySlideContent({ slide }: { slide: HydratedSlide | undefined }) {
  return (
    <>
      {slide?.mediaRef && <SlidePhoto handle={slide.mediaRef} mime={slide.mediaMime} />}
      <Stack gap={4} align="center" style={{ maxWidth: 640, textAlign: "center" }}>
        {(slide?.date || slide?.placeTitle) && (
          <Text size="sm" c="dimmed">
            {[slide?.date, slide?.placeTitle].filter(Boolean).join(" · ")}
          </Text>
        )}
        <Text size="xl" fw={700}>{slide?.title}</Text>
        <Text>{slide?.text ? renderStoryText(slide.text) : null}</Text>
      </Stack>
    </>
  );
}

/** "inline" is the original small under-text buttons + "n / N" counter, for
 * the unlocated (plain centered card) layout. "edge" is a pair of large
 * circular buttons pinned to the screen edges, dark/opaque regardless of
 * app theme so they stay legible over whatever the map happens to be
 * showing -- no counter in this variant, since the timeline strip's
 * highlighted dot already carries that information when there is one. */
function NavArrows({ index, total, onPrev, onNext, variant }: {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  variant: "inline" | "edge";
}) {
  if (variant === "edge") {
    return (
      <>
        <ActionIcon
          variant="filled" color="dark" size={56} radius="xl" disabled={index === 0} onClick={onPrev}
          aria-label="Previous"
          style={{ position: "absolute", left: 24, top: "50%", transform: "translateY(-50%)", opacity: 0.8, zIndex: 2 }}
        >
          <Text size="xl" c="white">&larr;</Text>
        </ActionIcon>
        <ActionIcon
          variant="filled" color="dark" size={56} radius="xl" disabled={index === total - 1} onClick={onNext}
          aria-label="Next"
          style={{ position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)", opacity: 0.8, zIndex: 2 }}
        >
          <Text size="xl" c="white">&rarr;</Text>
        </ActionIcon>
      </>
    );
  }
  return (
    <Group justify="center" gap="md" mt="md">
      <ActionIcon variant="light" size="lg" disabled={index === 0} onClick={onPrev} aria-label="Previous">&larr;</ActionIcon>
      <Text size="sm" c="dimmed">{index + 1} / {total}</Text>
      <ActionIcon variant="light" size="lg" disabled={index === total - 1} onClick={onNext} aria-label="Next">&rarr;</ActionIcon>
    </Group>
  );
}

export function StoryView({ spec, opened, onClose, stackId }: {
  spec: StorySpec | null; opened: boolean; onClose: () => void;
  /** Only set when opened from inside another Mantine Modal.Stack (see
   * StoryEditor.tsx's Preview button) -- without it, this plain unstacked
   * Modal defaults to the same base z-index as the dialog it's nested
   * inside, and renders *underneath* it rather than on top (Modal.mjs only
   * asks the stack for a z-index/focus-trap/overlay when both a `stackId`
   * and a surrounding Modal.Stack context are present). StoryActions.tsx's
   * standalone Present button (no surrounding stack) leaves this unset. */
  stackId?: string;
}) {
  const dark = useComputedColorScheme("light") === "dark";
  const [index, setIndex] = useState(0);
  const hydrated = useHydratedStory(spec);

  const slides = hydrated?.slides ?? [];
  const slide = slides[index];

  const datedSlides: StoryTimelinePoint[] = [];
  slides.forEach((s, i) => {
    if (s.year != null) datedSlides.push({ index: i, year: s.year });
  });
  const showTimeline = datedSlides.length >= 2;

  useEffect(() => {
    if (opened) setIndex(0);
  }, [opened, spec]);

  // Keyboard nav -- a fullscreen presentation is exactly where arrow keys
  // are expected to work; Escape already closes via Modal's own default.
  useEffect(() => {
    if (!opened) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, slides.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, slides.length]);

  if (!spec) return null;

  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));
  const goNext = () => setIndex((i) => Math.min(i + 1, slides.length - 1));
  const firstLocated = slides.find(isLocated);
  const currentPoint = slide && isLocated(slide) ? { lat: slide.lat, long: slide.long } : undefined;

  return (
    <Modal
      opened={opened} onClose={onClose} fullScreen withCloseButton={false} stackId={stackId}
      styles={{ body: { padding: 0 } }}
    >
      {/* Mantine's own Modal title bar is `position: sticky` in normal
          document flow, not a flex-sized sibling -- giving the body a
          percentage or flex height to "fill the rest" doesn't account for
          the header's own space, so body either overflows past the
          viewport (scrolling the header's-height worth of content off the
          bottom -- what "the timeline strip is scrolled off the window"
          turned out to be) or, worse, isn't a flex child of anything and
          collapses to nothing. `position: fixed` sidesteps the whole box
          model by anchoring directly to the viewport regardless of it --
          which is also why the title/close live here as an overlay
          instead of Modal's own `title`/header. */}
      <Box style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
        {/* A bare title/close overlay was unreadable over the map -- this
            bar gives both a backdrop regardless of what's under them,
            the same reasoning NavArrows' edge variant already has for its
            own dark opaque circles. */}
        <Box
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 56, zIndex: 3,
            background: dark ? "rgba(20,20,20,0.55)" : "rgba(255,255,255,0.55)",
          }}
        />
        <Text
          fw={600} truncate
          style={{ position: "absolute", top: 17, left: 20, right: 60, zIndex: 3 }}
        >
          {spec.title}
        </Text>
        <ActionIcon
          variant="filled" color="dark" size={36} radius="xl" onClick={onClose} aria-label="Close"
          style={{ position: "absolute", top: 10, right: 12, zIndex: 3, opacity: 0.8 }}
        >
          <Text size="lg" c="white">&times;</Text>
        </ActionIcon>
      {!hydrated ? (
        <Stack align="center" justify="center" style={{ height: "100%" }}>
          <Loader />
        </Stack>
      ) : firstLocated ? (
        <Box style={{ position: "relative", height: "100%", overflow: "hidden" }}>
          <StoryMapBackground
            initialCenter={[firstLocated.long, firstLocated.lat]}
            currentPoint={currentPoint}
            dark={dark}
            opened={opened}
            panelFraction={PANEL_FRACTION}
          />
          <Paper
            radius={0}
            style={{
              position: "absolute", top: 0, bottom: 0, right: 0, width: `${PANEL_FRACTION * 100}%`, zIndex: 1,
              padding: "var(--mantine-spacing-xl)", display: "flex", flexDirection: "column",
              justifyContent: "center", alignItems: "center", overflowY: "auto",
              // Starts fully transparent at 0% of *this panel* -- which sits
              // at the screen's own halfway mark, so the fade begins exactly
              // there -- and reaches fully solid well before the content
              // does (content is centered, so it never sits closer than
              // ~25% into the panel), so nothing readable ever has the map
              // showing through behind it.
              background: dark
                ? "linear-gradient(to right, transparent 0%, rgb(20,20,20) 22%)"
                : "linear-gradient(to right, transparent 0%, rgb(255,255,255) 22%)",
            }}
          >
            <StorySlideContent slide={slide} />
          </Paper>
          <NavArrows index={index} total={slides.length} onPrev={goPrev} onNext={goNext} variant="edge" />
          {showTimeline && <StoryTimelineStrip points={datedSlides} currentIndex={index} onSelect={setIndex} dark={dark} />}
        </Box>
      ) : (
        <Stack
          align="center" justify="center" gap="lg"
          style={{ height: "100%", position: "relative", overflowY: "auto", paddingBottom: showTimeline ? 80 : 0 }}
        >
          <StorySlideContent slide={slide} />
          <NavArrows index={index} total={slides.length} onPrev={goPrev} onNext={goNext} variant="inline" />
          {showTimeline && <StoryTimelineStrip points={datedSlides} currentIndex={index} onSelect={setIndex} dark={dark} />}
        </Stack>
      )}
      </Box>
    </Modal>
  );
}
