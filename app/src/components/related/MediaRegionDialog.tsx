import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button, Group, Loader, Modal } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchAuthedBlobUrl } from "../../store/authedFetch";
import { clampPct } from "../../store/mediaCrop";
import { t } from "../../i18n/i18n";

function filePath(handle: string): string {
  return `/api/media/${encodeURIComponent(handle)}/file`;
}

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const OPPOSITE: Record<Corner, Corner> = { nw: "se", ne: "sw", sw: "ne", se: "nw" };

// Below this (in percent of the image, either dimension), a drag reads as
// "clicked without meaning to draw anything" rather than a real region --
// dropped on pointer-up instead of saving a sliver nobody meant to crop to.
const MIN_SIZE_PCT = 2;

function cornerPoint(rect: number[], corner: Corner): { x: number; y: number } {
  const [x1, y1, x2, y2] = rect;
  return {
    x: corner === "nw" || corner === "sw" ? x1 : x2,
    y: corner === "nw" || corner === "ne" ? y1 : y2,
  };
}

type DragState =
  | { mode: "new"; start: { x: number; y: number } }
  | { mode: "move"; start: { x: number; y: number }; startRect: number[] }
  | { mode: "resize"; corner: Corner; anchor: { x: number; y: number } };

/** A MediaRef's own crop region editor (RefMeta.rect) -- draw a new
 * selection by dragging on the image, or move/resize an existing one.
 * Deliberately not built on ImageLightbox.tsx: that component's pointer
 * handling is for panning/pinch-zooming the whole image, which would fight
 * a draw/move/resize gesture over the same pointer events, so this shows
 * the original file (same `/file` + fetchAuthedBlobUrl blob-URL approach,
 * one image on screen at a time -- see authedFetch.ts's own doc comment)
 * at a fixed fit-to-modal scale instead, with its own hand-rolled
 * pointer-driven rectangle.
 *
 * All coordinates are percent of the *rendered* image (0-100) -- matches
 * gramps-web-api's crop_image(), which interprets a MediaRef's rect the
 * same way against the EXIF-oriented display image a plain <img> already
 * shows, so no orientation math is needed here. */
export function MediaRegionDialog({ opened, onClose, handle, initialRect, onSave }: {
  opened: boolean;
  onClose: () => void;
  handle: string;
  initialRect?: number[] | null;
  onSave: (rect: number[] | null) => void | Promise<void>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [rect, setRect] = useState<number[] | null>(null);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!opened) return;
    setRect(initialRect && initialRect.length === 4 ? initialRect : null);
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
        console.error("[media-region] failed to load image", err);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSrc(null);
    };
  }, [opened, handle, initialRect]);

  function pointFromEvent(e: ReactPointerEvent): { x: number; y: number } {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: clampPct(((e.clientX - box.left) / box.width) * 100),
      y: clampPct(((e.clientY - box.top) / box.height) * 100),
    };
  }

  function handleWrapPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    if (rect && p.x > rect[0] && p.x < rect[2] && p.y > rect[1] && p.y < rect[3]) {
      dragRef.current = { mode: "move", start: p, startRect: rect };
    } else {
      dragRef.current = { mode: "new", start: p };
      setRect([p.x, p.y, p.x, p.y]);
    }
  }

  function handleCornerPointerDown(e: ReactPointerEvent<HTMLDivElement>, corner: Corner) {
    e.stopPropagation();
    if (!rect) return;
    wrapRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { mode: "resize", corner, anchor: cornerPoint(rect, OPPOSITE[corner]) };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = pointFromEvent(e);
    if (drag.mode === "new") {
      setRect([
        Math.min(drag.start.x, p.x), Math.min(drag.start.y, p.y),
        Math.max(drag.start.x, p.x), Math.max(drag.start.y, p.y),
      ]);
    } else if (drag.mode === "move") {
      const [x1, y1, x2, y2] = drag.startRect;
      const w = x2 - x1;
      const h = y2 - y1;
      const nx1 = Math.min(Math.max(x1 + (p.x - drag.start.x), 0), 100 - w);
      const ny1 = Math.min(Math.max(y1 + (p.y - drag.start.y), 0), 100 - h);
      setRect([nx1, ny1, nx1 + w, ny1 + h]);
    } else {
      const { anchor } = drag;
      setRect([
        Math.min(anchor.x, p.x), Math.min(anchor.y, p.y),
        Math.max(anchor.x, p.x), Math.max(anchor.y, p.y),
      ]);
    }
  }

  function handlePointerUp() {
    dragRef.current = null;
    setRect((r) => (r && r[2] - r[0] >= MIN_SIZE_PCT && r[3] - r[1] >= MIN_SIZE_PCT ? r : null));
  }

  async function save(value: number[] | null) {
    setSaving(true);
    try {
      await onSave(value);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={t("Select region")}>
      {!src ? (
        <Loader />
      ) : (
        <div
          ref={wrapRef}
          onPointerDown={handleWrapPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            position: "relative", display: "inline-block", lineHeight: 0,
            touchAction: "none", cursor: "crosshair", maxWidth: "100%", overflow: "hidden",
          }}
        >
          <img
            src={src} alt="" draggable={false}
            style={{ display: "block", maxWidth: "100%", maxHeight: "70vh", userSelect: "none" }}
          />
          {rect && (
            <div
              style={{
                position: "absolute",
                left: `${rect[0]}%`, top: `${rect[1]}%`,
                width: `${rect[2] - rect[0]}%`, height: `${rect[3] - rect[1]}%`,
                border: "2px solid var(--mantine-color-blue-5)",
                background: "rgba(34, 139, 230, 0.15)",
                boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.35)",
                cursor: "move",
              }}
            >
              {CORNERS.map((corner) => (
                <div
                  key={corner}
                  onPointerDown={(e) => handleCornerPointerDown(e, corner)}
                  style={{
                    position: "absolute",
                    width: 14, height: 14,
                    background: "var(--mantine-color-blue-5)",
                    border: "1px solid white",
                    borderRadius: 2,
                    top: corner === "nw" || corner === "ne" ? -7 : undefined,
                    bottom: corner === "sw" || corner === "se" ? -7 : undefined,
                    left: corner === "nw" || corner === "sw" ? -7 : undefined,
                    right: corner === "ne" || corner === "se" ? -7 : undefined,
                    cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose} disabled={saving}>{t("Cancel")}</Button>
        {rect && (
          <Button variant="default" onClick={() => save(null)} loading={saving}>{t("Clear region")}</Button>
        )}
        <Button onClick={() => save(rect ? rect.map(clampPct) : null)} loading={saving} disabled={!rect}>
          {t("Save")}
        </Button>
      </Group>
    </Modal>
  );
}
