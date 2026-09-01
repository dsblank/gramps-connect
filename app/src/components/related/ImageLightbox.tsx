import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ActionIcon, Box, Loader, Modal } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchAuthedBlobUrl } from "../../store/authedFetch";
import { fetchObjectExtended } from "../../store/objectDetail";
import { MEDIA_VIEW } from "../../store/views";
import { formatHash } from "../../hash";
import { personName, summaryLine } from "./summary";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_CLICK_SCALE = 2.5;

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

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
 * Zoom/pan is hand-rolled (wheel + pinch + drag) rather than pulling in a
 * pan-zoom dependency -- there's no such library in this repo yet, and
 * CompareModal.tsx already hand-rolls its own pointer-driven divider drag,
 * so this follows the same house style rather than introducing a new one. */
export function ImageLightbox({ opened, onClose, handle }: {
  opened: boolean;
  onClose: () => void;
  handle: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  // Mirrors `transform` for the native (non-React) wheel listener below,
  // which is attached once and can't just close over each render's own
  // `transform` the way a React event handler would.
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const [regions, setRegions] = useState<Region[]>([]);
  // The image's own on-screen box at scale=1 (px, measured off the real
  // <img> once it loads) -- lets the region overlay below share the exact
  // box the browser gave the image via its own max-width/max-height:100%
  // fit-to-frame sizing, rather than reimplementing that fit arithmetic
  // (or fighting CSS percentage resolution inside an absolutely
  // positioned, already-transformed parent) just to size a sibling div.
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Pointers currently down, keyed by pointerId -- 1 means panning (once
  // zoomed in), 2 means pinch-zooming; a third simultaneous touch is
  // ignored rather than tracked, there's nothing more to do with it.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStart = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null);

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
    };
  }, [opened, handle]);

  // Reset pan/zoom whenever a (re)opened lightbox targets a given image, so
  // reopening -- or promoting to a different photo while it's open -- never
  // starts already zoomed in from a previous view. displaySize resets too,
  // so a stale (previous image's) size can't briefly mis-position the new
  // one's region overlay before the fresh <img> loads.
  useEffect(() => {
    if (opened) {
      setTransform({ scale: 1, x: 0, y: 0 });
      setDisplaySize(null);
    }
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

  // The img's current box divided by the current zoom scale -- recovers
  // the *base* (scale=1) size regardless of how zoomed in the user
  // currently is, so this doubles as both the initial on-load measurement
  // (scale is always 1 then -- the reset effect above already set it for
  // this (opened, handle) pair before the fresh <img> could load) and the
  // window-resize remeasurement below (where the user may well be zoomed
  // in already, and the frame's own max-width/max-height:100% fit changed
  // under it).
  function measureDisplaySize() {
    const box = imgRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const scale = transformRef.current.scale || 1;
    setDisplaySize({ w: box.width / scale, h: box.height / scale });
  }

  // Keeps the region overlay's box in sync with the image's own -- the
  // browser reflows the <img> itself automatically on resize (its
  // max-width/max-height:100% is relative to the frame), but displaySize
  // is plain JS state that only a remeasure can update.
  useEffect(() => {
    if (!opened) return;
    window.addEventListener("resize", measureDisplaySize);
    return () => window.removeEventListener("resize", measureDisplaySize);
  }, [opened]);

  function clampScale(s: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  // Zooms toward a client-coordinate point (cursor position, pinch
  // midpoint, ...) rather than the image center, so the spot the user is
  // pointing at stays under the pointer as the scale changes.
  function zoomAt(clientX: number, clientY: number, nextScale: number) {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const px = clientX - rect.left - rect.width / 2;
    const py = clientY - rect.top - rect.height / 2;
    setTransform((t) => {
      const s = clampScale(nextScale);
      if (s === MIN_SCALE) return { scale: 1, x: 0, y: 0 };
      const ratio = s / t.scale;
      return { scale: s, x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio };
    });
  }

  // React attaches its synthetic `wheel` listener as passive (perf default
  // since React 17), so e.preventDefault() inside a plain onWheel prop
  // throws "Unable to preventDefault inside passive event listener" and
  // silently fails to stop the browser's own page-zoom/scroll -- attaching
  // directly to the DOM node with { passive: false } is the fix, same
  // reasoning React's own docs give for this exact case.
  //
  // Depends on `opened`, not `[]`: Mantine's Modal doesn't render its
  // children into the DOM at all until `opened` is true (confirmed live --
  // frameRef.current is null on this component's *first* mount, which
  // happens as soon as its zoomable MediaThumbnail mounts, well before the
  // user has actually clicked to open it), so a mount-once effect would
  // see a null frame, bail, and never get another chance to attach.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    function handleWheelNative(e: WheelEvent) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0025);
      zoomAt(e.clientX, e.clientY, transformRef.current.scale * factor);
    }
    frame.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheelNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomAt reads
    // frameRef/transformRef fresh and updates via setTransform's functional
    // form, so it has no stale-closure dependency beyond `opened` itself.
  }, [opened]);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    } else if (pointers.current.size === 2) {
      panStart.current = null;
      const [p1, p2] = [...pointers.current.values()];
      pinchStart.current = { dist: distance(p1, p2), scale: transform.scale, cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2 };
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [p1, p2] = [...pointers.current.values()];
      const nextScale = pinchStart.current.scale * (distance(p1, p2) / pinchStart.current.dist);
      zoomAt(pinchStart.current.cx, pinchStart.current.cy, nextScale);
      return;
    }

    if (pointers.current.size === 1 && panStart.current && transform.scale > 1) {
      const start = panStart.current;
      setTransform((t) => ({ ...t, x: start.tx + (e.clientX - start.x), y: start.ty + (e.clientY - start.y) }));
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      panStart.current = { x: p.x, y: p.y, tx: transform.x, ty: transform.y };
    } else {
      panStart.current = null;
    }
  }

  function handleDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (transform.scale > 1) {
      setTransform({ scale: 1, x: 0, y: 0 });
    } else {
      zoomAt(e.clientX, e.clientY, DOUBLE_CLICK_SCALE);
    }
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        style={{
          position: "relative", width: "100%", height: "100%", overflow: "hidden",
          touchAction: "none", cursor: transform.scale > 1 ? "grab" : "default",
        }}
      >
        {!src ? (
          <Loader color="white" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }} />
        ) : (
          <>
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={measureDisplaySize}
              style={{
                position: "absolute", top: "50%", left: "50%", maxWidth: "100%", maxHeight: "100%",
                transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                transition: pointers.current.size > 0 ? "none" : "transform 0.15s ease-out",
                userSelect: "none",
              }}
            />
            {/* A sibling, not a child of the <img> above -- same center +
                pan/zoom transform, but an explicit pixel box (displaySize)
                rather than the img's own percentage-based sizing, so each
                region's percent-of-image position lands in the right
                place regardless of how the img itself was sized. Tracking
                the same transform string is what makes this "redraw" as
                the user zooms/pans -- it's really just along for the ride
                on a CSS transform, not recomputed per frame. */}
            {displaySize && regions.length > 0 && (
              <div
                style={{
                  position: "absolute", top: "50%", left: "50%",
                  width: displaySize.w, height: displaySize.h,
                  transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  transition: pointers.current.size > 0 ? "none" : "transform 0.15s ease-out",
                  pointerEvents: "none",
                }}
              >
                {regions.map((r) => (
                  <div
                    key={`${r.type}-${r.handle}`}
                    role="button"
                    tabIndex={0}
                    // The frame beneath calls setPointerCapture(e.pointerId)
                    // on itself from *its own* onPointerDown -- since that's
                    // a bubbling listener, a pointerdown that started here
                    // would otherwise still reach it and hijack the pointer
                    // (and with it, the click that's about to follow) away
                    // from this box entirely. Stopped at both pointerdown
                    // and click so neither the capture nor the frame's own
                    // pan-gesture bookkeeping ever sees this interaction.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      window.location.hash = formatHash({ viewKey: r.type, handle: r.handle });
                      onClose();
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.stopPropagation();
                      window.location.hash = formatHash({ viewKey: r.type, handle: r.handle });
                      onClose();
                    }}
                    style={{
                      position: "absolute",
                      left: `${r.rect[0]}%`, top: `${r.rect[1]}%`,
                      width: `${r.rect[2] - r.rect[0]}%`, height: `${r.rect[3] - r.rect[1]}%`,
                      border: "2px solid rgba(255, 255, 255, 0.85)",
                      boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.6)",
                      pointerEvents: "auto",
                      cursor: "pointer",
                    }}
                  >
                    <span
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
            )}
          </>
        )}

        <ActionIcon
          variant="filled" color="dark" size={36} radius="xl" onClick={onClose} aria-label="Close"
          style={{ position: "absolute", top: 16, right: 16, zIndex: 3 }}
        >
          ✕
        </ActionIcon>
      </Box>
    </Modal>
  );
}
