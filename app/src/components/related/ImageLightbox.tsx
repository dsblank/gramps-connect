import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ActionIcon, Anchor, Box, Group, Loader, Modal, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { canChangeData } from "../../pyodidePoc/grampletCommit";
import { faceWhoLabel, markFaceNow, undoMarkFace, type FaceWho } from "../../store/markFace";
import { clampPct } from "../../store/mediaCrop";
import { FaceWhoPicker } from "./FaceWhoPicker";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { FullscreenDownloadButton } from "./FullscreenDownloadButton";
import { getToken } from "../../auth/auth";
import { fetchAuthedBlobUrl } from "../../store/authedFetch";
import { fetchObjectExtended } from "../../store/objectDetail";
import { MEDIA_VIEW } from "../../store/views";
import { formatHash } from "../../hash";
import { personName, summaryLine } from "./summary";
import { t } from "../../i18n/i18n";

const MAX_SCALE = 8;
const DOUBLE_CLICK_SCALE = 2.5;
/** One click of the corner zoom buttons (or a +/- key press), as a
 * multiplier -- the library's own zoomIn()/zoomOut() step is an absolute
 * scale increment, which feels slow once already zoomed in. */
const BUTTON_FACTOR = 1.5;
/** Class on the region boxes, excluded from the library's panning so a
 * click on one always lands as a click. */
const REGION_CLASS = "lightbox-region";
/** A drawn box smaller than this (percent of the photo, either way) was a
 * click, not a box. */
const MIN_BOX_PCT = 2;

/** Marking someone in the photo: what to do with a box once it's named.
 * Without this, the lightbox writes it to the tree at once (with an Undo
 * notice) when the user may change data. */
export interface LightboxFaces {
  /** The regions to draw instead of fetching them (the Evidence Board's,
   * with its unsaved faces). */
  regions?: Region[];
  /** People to offer first in "Who is this?". */
  known?: { value: string; label: string }[];
  onAdd: (rect: number[], who: FaceWho) => void | Promise<void>;
  /** Shown on the confirming buttons (the board's tree mark). */
  saveIcon?: ReactNode;
}

/** The raw stored file, not a thumbnail -- same /file endpoint
 * MapItemEditorDialog.tsx uses for map overlays. One image at a time (this
 * is the only thing on screen while it's open), so it's worth the
 * fetch-then-blob-URL indirection fetchAuthedBlobUrl() does to keep the
 * access token out of the URL entirely (discussion #4) -- unlike
 * MediaThumbnail.tsx/treeData.ts's personThumbnailUrl, which render many
 * images at once and stay on the simpler `?jwt=` query-param approach. */
function filePath(handle: string): string {
  return `/api/media/${encodeURIComponent(handle)}/file`;
}

export interface Region {
  type: string;
  handle: string;
  label: string;
  rect: number[];
}

/** Every MediaRef pointing at `handle` that carries its own crop rect --
 * `extended.backlinks[type]` (fetchObjectExtended's raw shape, not the
 * profile-substituted one objectDetail.ts's own getBacklinks() prefers for
 * display) resolves each backlink to the *full* raw object
 * (gramps-web-api's get_extended_attributes calls get_<type>_from_handle,
 * not a lighter profile projection), so every backlink type's own
 * media_list -- rect included -- is actually present here, unlike
 * BacklinksSection.tsx's per-item ref metadata (which genuinely isn't
 * recoverable -- see its own doc comment; that's about *this* object's ref
 * *into* the backlink, not the backlink's ref back to *this* media). */
export function extractRegions(detail: { extended?: Record<string, unknown> } | null, handle: string): Region[] {
  const backlinks = (detail?.extended?.backlinks as Record<string, { handle: string; media_list?: { ref: string; rect?: number[] }[] }[]> | undefined) ?? {};
  const regions: Region[] = [];
  for (const [type, objs] of Object.entries(backlinks)) {
    for (const obj of objs) {
      const rect = obj.media_list?.find((m) => m.ref === handle)?.rect;
      if (!rect || rect.length !== 4 || !(rect[2] > rect[0] && rect[3] > rect[1])) continue;
      // Person labels skip summaryLine's usual [gramps_id] prefix -- just
      // given name + surname reads better floating under a face crop than
      // a full "[I0123] John Michael Smith" record label does; every other
      // backlink type keeps summaryLine's own id-prefixed summary.
      const label = type === "person" ? personName(obj) : summaryLine(type, obj);
      regions.push({ type, handle: obj.handle, label: label || type, rect });
    }
  }
  return regions;
}

/** Fullscreen zoomable/pannable view of a Media object's original file --
 * MediaThumbnail.tsx's zoom affordance opens this instead of the app ever
 * showing a photo at anything past thumbnail resolution. fullScreen + no
 * Modal.Stack, same standalone-presentation convention CompareModal.tsx and
 * StoryView.tsx already use.
 *
 * Also draws every MediaRef.rect that points at this photo, each labeled
 * with its own referencing object (usually a person's name, see
 * extractRegions() above) and clickable -- a real view switch
 * (window.location.hash, same mechanism AsideSplit.tsx's own bottom-pane
 * onPromote uses), closing the lightbox first since it'd otherwise sit on
 * top of whatever page that navigated to. This is the non-editing
 * counterpart to MediaRegionDialog.tsx (MediaSection.tsx's ✂ button, which
 * only edits the *current* page's own reference); this shows -- and can
 * jump to -- every reference at once, from wherever the photo happens to
 * be opened.
 *
 * Zoom/pan (wheel, pinch, drag, double-click, bounds) is react-zoom-pan-pinch
 * rather than hand-rolled. The image is CSS-fitted to the screen (scale 1 =
 * fitted) and the content box shrink-wraps it, so the library's bounds are
 * the photo's own edges (centerOnInit/centerZoomedOut center it, including
 * once the image loads late). The region overlays are positioned by percent
 * inside that same box, so they ride along on the one transform with no
 * measuring. */
export function ImageLightbox({ opened, onClose, handle, onRegion, regionAction, faces, startMarking }: {
  opened: boolean;
  onClose: () => void;
  handle: string;
  /** What clicking a region does instead of opening its record's page (the
   * Evidence Board pins the person up rather than leaving the board). */
  onRegion?: (region: Region) => void;
  /** Tooltip words for that click, e.g. "Pin up". */
  regionAction?: string;
  faces?: LightboxFaces;
  /** Open with "Mark someone" already on. */
  startMarking?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [fetchedRegions, setRegions] = useState<Region[]>([]);
  const regions = faces?.regions ?? fetchedRegions;
  /** Bumped after a face is written here, to fetch the regions again. */
  const [reload, setReload] = useState(0);
  const canMark = !!faces || canChangeData();
  /** "Mark someone" is on: dragging draws a box instead of panning. */
  const [marking, setMarking] = useState(false);
  /** The box being drawn or named, in percent of the photo. */
  const [box, setBox] = useState<number[] | null>(null);
  const drawFrom = useRef<{ x: number; y: number } | null>(null);
  /** Where "Who is this?" opens (frame coordinates), once a box is drawn. */
  const [askAt, setAskAt] = useState<{ left: number; top: number } | null>(null);
  const [scale, setScale] = useState(1);
  const zoomRef = useRef<ReactZoomPanPinchContentRef>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgBoxRef = useRef<HTMLDivElement>(null);
  // Where the last press started, so the click that ends a drag (pan) isn't
  // mistaken for a click on the background.
  const pressAt = useRef<{ x: number; y: number } | null>(null);

  // Fetches fresh (not cached across opens) and revokes its own blob URL on
  // close/handle-change/unmount -- the object URL is only ever meant to
  // live as long as this one <img> shows it.
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const token = await getToken();
        const url = await fetchAuthedBlobUrl(filePath(handle), token);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setSrc(url);
      } catch (err) {
        console.error("[lightbox] failed to load image", err);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSrc(null);
      setScale(1);
    };
  }, [opened, handle]);

  // Every MediaRef with a crop rect pointing at this media object --
  // fetched independently of whatever page opened the lightbox (a
  // MediaSection row only knows the *current* record's own reference, not
  // every other object that also references this same photo). Best-effort:
  // a failure here still lets the photo itself display, it just draws no
  // regions.
  const regionsGiven = !!faces?.regions;
  useEffect(() => {
    if (!opened || regionsGiven) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const token = await getToken();
        const detail = await fetchObjectExtended(token, MEDIA_VIEW, handle, controller.signal);
        if (!cancelled) setRegions(extractRegions(detail, handle));
      } catch (err) {
        if (!cancelled) console.error("[lightbox] failed to load crop regions", err);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [opened, handle, regionsGiven, reload]);
  useEffect(() => {
    setRegions([]);
    setMarking(!!startMarking && opened);
    setBox(null);
    setAskAt(null);
  }, [opened, handle]);

  // Buttons and keys zoom toward the screen's center, multiplicatively.
  function zoomCentered(factor: number) {
    const z = zoomRef.current;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!z || !rect) return;
    const next = Math.min(MAX_SCALE, Math.max(1, z.state.scale * factor));
    if (next === 1) z.resetTransform(200);
    else z.zoomToPoint(next, rect.left + rect.width / 2, rect.top + rect.height / 2, 200);
  }

  // The library's own keyboard support only listens on its wrapper (which
  // would need focus first), so +/-/0 and arrows are wired at window level.
  useEffect(() => {
    if (!opened) return;
    function handleKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const z = zoomRef.current;
      if (!z) return;
      if (e.key === "+" || e.key === "=") zoomCentered(BUTTON_FACTOR);
      else if (e.key === "-" || e.key === "_") zoomCentered(1 / BUTTON_FACTOR);
      else if (e.key === "0") z.resetTransform(200);
      else if (e.key === "ArrowLeft") z.panBy(100, 0);
      else if (e.key === "ArrowRight") z.panBy(-100, 0);
      else if (e.key === "ArrowUp") z.panBy(0, 100);
      else if (e.key === "ArrowDown") z.panBy(0, -100);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [opened]);

  // Escape steps back out of marking (the box first) before it closes.
  function onEscape() {
    if (askAt || box) {
      setBox(null);
      setAskAt(null);
    } else if (marking) setMarking(false);
    else onClose();
  }

  function pct(e: ReactPointerEvent): { x: number; y: number } {
    const b = imgBoxRef.current?.getBoundingClientRect();
    if (!b) return { x: 0, y: 0 };
    return { x: clampPct(((e.clientX - b.left) / b.width) * 100), y: clampPct(((e.clientY - b.top) / b.height) * 100) };
  }
  function drawStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (!marking || askAt) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pct(e);
    drawFrom.current = p;
    setBox([p.x, p.y, p.x, p.y]);
  }
  function drawMove(e: ReactPointerEvent<HTMLDivElement>) {
    const from = drawFrom.current;
    if (!from) return;
    const p = pct(e);
    setBox([Math.min(from.x, p.x), Math.min(from.y, p.y), Math.max(from.x, p.x), Math.max(from.y, p.y)]);
  }
  function drawEnd() {
    if (!drawFrom.current) return;
    drawFrom.current = null;
    if (!box || box[2] - box[0] < MIN_BOX_PCT || box[3] - box[1] < MIN_BOX_PCT) {
      setBox(null);
      return;
    }
    const img = imgBoxRef.current?.getBoundingClientRect();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!img || !frame) return;
    const left = img.left + (box[0] / 100) * img.width - frame.left;
    const bottom = img.top + (box[3] / 100) * img.height - frame.top;
    setAskAt({
      left: Math.max(8, Math.min(left, frame.width - 310)),
      top: Math.max(64, Math.min(bottom + 8, frame.height - 260)),
    });
  }

  async function name(who: FaceWho) {
    const rect = box;
    if (!rect) return;
    setBox(null);
    setAskAt(null);
    if (faces) {
      await faces.onAdd(rect, who);
      return;
    }
    try {
      const saved = await markFaceNow(handle, rect, who);
      setReload((n) => n + 1);
      if (!saved) return;
      notifications.show({
        color: "green",
        autoClose: 12000,
        message: (
          <Group gap="xs">
            <Text size="sm">{t("Marked")}: {faceWhoLabel(who)}</Text>
            <Anchor
              component="button"
              size="sm"
              onClick={async () => {
                try {
                  await undoMarkFace(saved);
                  setReload((n) => n + 1);
                  notifications.show({ color: "blue", message: t("Undone. The tree is back to how it was.") });
                } catch (err) {
                  notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) });
                }
              }}
            >
              {t("Undo")}
            </Anchor>
          </Group>
        ),
      });
    } catch (err) {
      notifications.show({ color: "red", title: t("Not saved"), message: err instanceof Error ? err.message : String(err) });
    }
  }

  function goToRegion(r: Region) {
    if (onRegion) onRegion(r);
    else window.location.hash = formatHash({ viewKey: r.type, handle: r.handle });
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={onEscape}
      fullScreen
      withCloseButton={false}
      styles={{ body: { height: "100vh", padding: 0, background: "#000" }, content: { background: "#000" } }}
    >
      <Box
        ref={frameRef}
        onPointerDownCapture={(e) => { pressAt.current = { x: e.clientX, y: e.clientY }; }}
        onClick={(e) => {
          // The Modal is portaled, but React still bubbles its events up the
          // *component* tree -- into the thumbnail and whatever clickable
          // row/tile holds it -- so a click in here must stop at the frame.
          e.stopPropagation();
          // A plain click (not the end of a drag) on the black around the
          // photo closes, like most lightboxes; a click on the photo itself,
          // or on a corner button, doesn't.
          const start = pressAt.current;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
          if ((e.target as HTMLElement).closest("button, [data-lightbox-keep]")) return;
          // While marking, a stray click never throws the work away.
          if (marking) return;
          const box = imgBoxRef.current?.getBoundingClientRect();
          if (box && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom) return;
          onClose();
        }}
        style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
      >
        {!src ? (
          <Loader color="white" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }} />
        ) : (
          <TransformWrapper
            ref={zoomRef}
            key={src}
            minScale={1}
            maxScale={MAX_SCALE}
            centerOnInit
            centerZoomedOut
            panning={{ disabled: marking, excluded: [REGION_CLASS] }}
            doubleClick={{ disabled: true }}
            onTransform={(_ref, state) => setScale(state.scale)}
          >
            {(controls) => (
              <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%" }}
              >
                <div
                  ref={imgBoxRef}
                  // Double-click toggles between fitted and a zoom on the
                  // clicked spot (the library's own "toggle" mode only
                  // steps out, it doesn't snap back to fitted).
                  onDoubleClick={(e) => {
                    if (marking) return;
                    if (controls.state.scale > 1) controls.resetTransform(200);
                    else controls.zoomToPoint(DOUBLE_CLICK_SCALE, e.clientX, e.clientY, 200);
                  }}
                  onPointerDown={drawStart}
                  onPointerMove={drawMove}
                  onPointerUp={drawEnd}
                  onPointerCancel={drawEnd}
                  style={{ position: "relative", lineHeight: 0, cursor: marking ? "crosshair" : scale > 1 ? "grab" : "default", touchAction: marking ? "none" : undefined }}
                >
                  <img
                    src={src}
                    alt=""
                    draggable={false}
                    style={{ display: "block", maxWidth: "100vw", maxHeight: "100vh", userSelect: "none" }}
                  />
                  {regions.map((r) => (
                    <div
                      key={`${r.type}-${r.handle}`}
                      className={REGION_CLASS}
                      role="button"
                      tabIndex={0}
                      title={regionAction ? `${t(regionAction)}: ${r.label}` : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        goToRegion(r);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.stopPropagation();
                        goToRegion(r);
                      }}
                      style={{
                        position: "absolute",
                        left: `${r.rect[0]}%`, top: `${r.rect[1]}%`,
                        width: `${r.rect[2] - r.rect[0]}%`, height: `${r.rect[3] - r.rect[1]}%`,
                        border: "2px solid rgba(255, 255, 255, 0.85)",
                        boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.6)",
                        cursor: "pointer",
                        // While marking, boxes can be drawn over them.
                        pointerEvents: marking ? "none" : undefined,
                      }}
                    >
                      <span
                        className={REGION_CLASS}
                        style={{
                          position: "absolute", top: "100%", left: 0, marginTop: 4,
                          background: "rgba(0, 0, 0, 0.65)", color: "#fff",
                          fontSize: 12, lineHeight: 1.4, padding: "1px 5px", borderRadius: 3,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.label}
                      </span>
                    </div>
                  ))}
                  {box && (
                    <div
                      style={{
                        position: "absolute", pointerEvents: "none",
                        left: `${box[0]}%`, top: `${box[1]}%`,
                        width: `${box[2] - box[0]}%`, height: `${box[3] - box[1]}%`,
                        border: "2px solid var(--mantine-color-yellow-4)",
                        boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.35)",
                      }}
                    />
                  )}
                </div>
              </TransformComponent>
            )}
          </TransformWrapper>
        )}

        {/* Left of Download (right: 60), styled like it. */}
        {([
          { label: t("Zoom out"), factor: 1 / BUTTON_FACTOR, right: 148, disabled: scale <= 1.001, glyph: "M5 12h14" },
          { label: t("Zoom in"), factor: BUTTON_FACTOR, right: 104, disabled: scale >= MAX_SCALE - 0.001, glyph: "M5 12h14M12 5v14" },
        ]).map((b) => (
          <Tooltip key={b.label} label={b.label} withArrow position="bottom">
            <ActionIcon
              variant="filled" color="dark" size={36} radius="xl"
              onClick={() => zoomCentered(b.factor)}
              disabled={!src || b.disabled}
              aria-label={b.label}
              style={{ position: "absolute", top: 16, right: b.right, zIndex: 3 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d={b.glyph} />
              </svg>
            </ActionIcon>
          </Tooltip>
        ))}
        {canMark && (
          <Tooltip label={marking ? t("Stop marking") : t("Mark someone in this photo")} withArrow position="bottom">
            <ActionIcon
              variant="filled" color={marking ? "yellow" : "dark"} size={36} radius="xl"
              onClick={() => {
                setMarking((m) => !m);
                setBox(null);
                setAskAt(null);
              }}
              disabled={!src}
              aria-label={t("Mark someone in this photo")}
              aria-pressed={marking}
              style={{ position: "absolute", top: 16, right: 192, zIndex: 3 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
                <circle cx="12" cy="10" r="2.5" />
                <path d="M8 16.5c.8-1.6 2.3-2.5 4-2.5s3.2.9 4 2.5" />
              </svg>
            </ActionIcon>
          </Tooltip>
        )}
        {marking && !askAt && (
          <Text
            size="sm"
            style={{ position: "absolute", top: 22, left: "50%", transform: "translateX(-50%)", zIndex: 3, color: "#fff", background: "rgba(0, 0, 0, 0.65)", padding: "4px 10px", borderRadius: 4, pointerEvents: "none" }}
          >
            {t("Drag a box around someone's face. Esc to stop.")}
          </Text>
        )}
        {askAt && (
          <Box style={{ position: "absolute", left: askAt.left, top: askAt.top, zIndex: 4 }} data-lightbox-keep>
            <FaceWhoPicker
              known={faces?.known}
              exclude={new Set(regions.map((r) => r.handle))}
              saveIcon={faces?.saveIcon}
              onPick={(who) => void name(who)}
              onCancel={() => {
                setBox(null);
                setAskAt(null);
              }}
            />
          </Box>
        )}
        <FullscreenDownloadButton handle={handle} blobUrl={src} />
        <ActionIcon
          variant="filled" color="dark" size={36} radius="xl" onClick={onClose} aria-label={t("Close")}
          style={{ position: "absolute", top: 16, right: 16, zIndex: 3 }}
        >
          ✕
        </ActionIcon>
      </Box>
    </Modal>
  );
}
