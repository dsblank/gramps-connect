import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { ActionIcon, Box, Loader, Modal } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { API_BASE } from "../../config";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_CLICK_SCALE = 2.5;

/** The raw stored file, not a thumbnail -- same /file endpoint
 * MapItemEditorDialog.tsx uses for map overlays, which already established
 * that it accepts the same `jwt` query-param auth as /thumbnail/<size>
 * (an <img src> can't carry an Authorization header). */
function fileUrl(handle: string, token: string): string {
  return `${API_BASE}/api/media/${encodeURIComponent(handle)}/file?jwt=${encodeURIComponent(token)}`;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Fullscreen zoomable/pannable view of a Media object's original file --
 * MediaThumbnail.tsx's zoom affordance opens this instead of the app ever
 * showing a photo at anything past thumbnail resolution. fullScreen + no
 * Modal.Stack, same standalone-presentation convention CompareModal.tsx and
 * StoryView.tsx already use.
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
  const [token, setToken] = useState<string | null>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  // Pointers currently down, keyed by pointerId -- 1 means panning (once
  // zoomed in), 2 means pinch-zooming; a third simultaneous touch is
  // ignored rather than tracked, there's nothing more to do with it.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStart = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    getToken().then((t) => {
      if (!cancelled) setToken(t);
    });
    return () => {
      cancelled = true;
    };
  }, [opened]);

  // Reset pan/zoom whenever a (re)opened lightbox targets a given image, so
  // reopening -- or promoting to a different photo while it's open -- never
  // starts already zoomed in from a previous view.
  useEffect(() => {
    if (opened) setTransform({ scale: 1, x: 0, y: 0 });
  }, [opened, handle]);

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

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0025);
    zoomAt(e.clientX, e.clientY, transform.scale * factor);
  }

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
        onWheel={handleWheel}
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
        {!token ? (
          <Loader color="white" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }} />
        ) : (
          <img
            src={fileUrl(handle, token)}
            alt=""
            draggable={false}
            style={{
              position: "absolute", top: "50%", left: "50%", maxWidth: "100%", maxHeight: "100%",
              transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transition: pointers.current.size > 0 ? "none" : "transform 0.15s ease-out",
              userSelect: "none",
            }}
          />
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
