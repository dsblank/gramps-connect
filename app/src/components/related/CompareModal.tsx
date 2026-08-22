import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ActionIcon, Box, Loader, Modal, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { API_BASE } from "../../config";

export interface CompareImage {
  handle: string;
  desc?: string;
}

// Large enough to look sharp full-screen without pulling the raw original
// file -- same /thumbnail/<size> endpoint MediaThumbnail.tsx uses, just a
// much bigger size than its 40/240px inline uses.
const IMAGE_SIZE = 1600;

function imageUrl(handle: string, token: string): string {
  return `${API_BASE}/api/media/${encodeURIComponent(handle)}/thumbnail/${IMAGE_SIZE}?jwt=${encodeURIComponent(token)}`;
}

/** Before/after slider between two Media images (RelatedPanel's Comparisons
 * section -- ComparisonsSection.tsx, store/comparisonApi.ts). A fixed frame
 * with the "bottom" image full-size and the "top" image stacked over it,
 * clipped to the right of a draggable divider -- dragging left reveals more
 * of the bottom image, right reveals more of the top, the classic
 * Juxtapose-style before/after slider rather than a side-by-side pair, so
 * the same region of the photo lines up under the divider as it moves.
 * Swap flips which of the two images is "top" vs "bottom" (and their
 * labels) without touching the divider position or re-fetching anything.
 * fullScreen + no Modal.Stack, same convention as StoryView.tsx's own
 * standalone presentation modal -- this has no parent stack either. */
export function CompareModal({ opened, onClose, a, b }: {
  opened: boolean;
  onClose: () => void;
  a: CompareImage;
  b: CompareImage;
}) {
  const [swapped, setSwapped] = useState(false);
  const [pos, setPos] = useState(50);
  const [token, setToken] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);

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

  const top = swapped ? a : b;
  const bottom = swapped ? b : a;

  function updateFromClientX(clientX: number) {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }
  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  }
  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      styles={{ body: { height: "100vh", padding: 0, background: "#000" }, content: { background: "#000" } }}
    >
      <Box ref={frameRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        {!token ? (
          <Loader color="white" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }} />
        ) : (
          <>
            <img
              src={imageUrl(bottom.handle, token)}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
            />
            <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${pos}%)` }}>
              <img
                src={imageUrl(top.handle, token)}
                alt=""
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>

            {/* Semi-opaque backdrop behind the labels/close button, same
                reasoning as StoryView.tsx's own top bar -- a bare label
                floated straight over an arbitrary photo is unreadable
                wherever that photo happens to be light. */}
            <Box style={{ position: "absolute", top: 0, left: 0, right: 0, height: 56, zIndex: 1, background: "rgba(20,20,20,0.55)" }} />
            <Text
              fw={700}
              c="white"
              style={{ position: "absolute", top: 16, left: 16, textShadow: "0 1px 4px black", zIndex: 1 }}
            >
              {bottom.desc || "(untitled)"}
            </Text>
            <Text
              fw={700}
              c="white"
              style={{ position: "absolute", top: 16, right: 64, textShadow: "0 1px 4px black", zIndex: 1 }}
            >
              {top.desc || "(untitled)"}
            </Text>

            {/* Divider + drag handle -- pointer capture is set on this same
                element, so its own move/up handlers (not the frame's) keep
                receiving events for the rest of the drag even if the
                pointer strays outside the thin hit area. */}
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{
                position: "absolute", top: 0, bottom: 0, left: `${pos}%`,
                width: 24, marginLeft: -12, cursor: "ew-resize", touchAction: "none",
                display: "flex", justifyContent: "center", zIndex: 2,
              }}
            >
              <div style={{ width: 2, height: "100%", background: "white", boxShadow: "0 0 6px rgba(0,0,0,0.6)" }} />
              <div
                style={{
                  position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                  width: 32, height: 32, borderRadius: "50%", background: "white",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 6px rgba(0,0,0,0.6)", fontSize: 16,
                }}
              >
                ⇔
              </div>
            </div>
          </>
        )}

        <ActionIcon
          variant="filled" color="dark" size={36} radius="xl" onClick={onClose} aria-label="Close"
          style={{ position: "absolute", top: 16, right: 16, zIndex: 3 }}
        >
          ✕
        </ActionIcon>
        <ActionIcon
          variant="filled" color="dark" size={48} radius="xl" onClick={() => setSwapped((s) => !s)} aria-label="Swap"
          style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 3 }}
        >
          ⇄
        </ActionIcon>
      </Box>
    </Modal>
  );
}
