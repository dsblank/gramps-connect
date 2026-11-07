import { useEffect, useRef, useState } from "react";
import { ActionIcon, Box, Loader, Modal, Tooltip } from "@mantine/core";
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

interface Region {
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
function extractRegions(detail: { extended?: Record<string, unknown> } | null, handle: string): Region[] {
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
export function ImageLightbox({ opened, onClose, handle }: {
  opened: boolean;
  onClose: () => void;
  handle: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
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
  useEffect(() => {
    if (!opened) return;
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
      setRegions([]);
    };
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

  function goToRegion(r: Region) {
    window.location.hash = formatHash({ viewKey: r.type, handle: r.handle });
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
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
          if ((e.target as HTMLElement).closest("button")) return;
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
            panning={{ excluded: [REGION_CLASS] }}
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
                    if (controls.state.scale > 1) controls.resetTransform(200);
                    else controls.zoomToPoint(DOUBLE_CLICK_SCALE, e.clientX, e.clientY, 200);
                  }}
                  style={{ position: "relative", lineHeight: 0, cursor: scale > 1 ? "grab" : "default" }}
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
