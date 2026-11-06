// A free-floating, non-modal window: drag it by its title bar, resize it
// from its corner, double-click the title (or ⤢) to maximize, ▾ to
// minimize it to a chip in the shared bottom dock (store/bottomDock.ts).
// Its position and size are remembered per `storageKey`, per browser.
// Used by (window) Gramplets (pyodidePoc/GrampletWindow.tsx) and External
// Search (related/ExternalSearchWindow.tsx); stacking among all of them is
// store/windowStack.ts. The owner keeps its open/minimized state and
// mounts this outside AppShell, so it stays up across navigation.
//
// Stays mounted while minimized -- only hidden, with the chip standing in
// for it -- so whatever it holds (a run, half-typed input) is still there
// when it's restored.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Box, Group, Paper, Text, UnstyledButton } from "@mantine/core";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { t } from "../i18n/i18n";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
/** How far each further window is offset from the previous one when no
 * position of its own was remembered. */
const CASCADE_STEP = 28;

interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Keeps at least the title bar on screen, after a browser resize or a
 * position remembered from a bigger screen. */
function clampGeometry(g: Geometry): Geometry {
  const width = Math.max(MIN_WIDTH, Math.min(g.width, window.innerWidth - 16));
  const height = Math.max(MIN_HEIGHT, Math.min(g.height, window.innerHeight - 16));
  return {
    width,
    height,
    left: Math.max(8 - width + 120, Math.min(g.left, window.innerWidth - 120)),
    top: Math.max(8, Math.min(g.top, window.innerHeight - 40)),
  };
}

function initialGeometry(storageKey: string, cascadeIndex: number, width: number, height: number): Geometry {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const g = JSON.parse(raw) as Geometry;
      if ([g.left, g.top, g.width, g.height].every(Number.isFinite)) return clampGeometry(g);
    }
  } catch {
    // Unreadable/unavailable storage -- fall through to the default.
  }
  const offset = cascadeIndex * CASCADE_STEP;
  return clampGeometry({
    left: window.innerWidth - width - 24 - offset,
    top: window.innerHeight - height - 72 - offset,
    width,
    height,
  });
}

function storeGeometry(storageKey: string, g: Geometry): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(g));
  } catch {
    // Not worth surfacing -- the window just opens at its default next time.
  }
}

export function FloatingWindow({
  storageKey,
  title,
  zIndex,
  minimized,
  chipRight,
  chipWidth,
  cascadeIndex = 0,
  defaultWidth = 560,
  defaultHeight = 480,
  titleExtra,
  headerButtons,
  chipStatus,
  onFocus,
  onMinimize,
  onClose,
  children,
}: {
  /** localStorage key its position and size are remembered under. */
  storageKey: string;
  title: string;
  zIndex: number;
  minimized: boolean;
  /** The chip's offset from the right edge while minimized (its place in
   * the shared bottom dock). */
  chipRight: number;
  chipWidth: number;
  /** Its position among open windows of its kind, for the default cascade. */
  cascadeIndex?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  /** Beside the title (e.g. a badge). */
  titleExtra?: ReactNode;
  /** Before the Minimize/Maximize/Close buttons. */
  headerButtons?: ReactNode;
  /** On the minimized chip, after its title (e.g. progress). */
  chipStatus?: ReactNode;
  /** Any pointer-down inside the window -- bring it to the front. */
  onFocus: () => void;
  onMinimize: (minimized: boolean) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [geometry, setGeometry] = useState<Geometry>(() =>
    initialGeometry(storageKey, cascadeIndex, defaultWidth, defaultHeight)
  );
  const [maximized, setMaximized] = useState(false);
  const paperRef = useRef<HTMLDivElement | null>(null);

  // Dragging by the title bar. Pointer capture keeps the drag going even
  // when the pointer outruns the window.
  const dragRef = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);
  function onTitlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (maximized || e.button !== 0 || (e.target as HTMLElement).closest("button, [role=button]")) return;
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, left: geometry.left, top: geometry.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onTitlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setGeometry((g) =>
      clampGeometry({ ...g, left: drag.left + e.clientX - drag.pointerX, top: drag.top + e.clientY - drag.pointerY })
    );
  }
  function onTitlePointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setGeometry((g) => {
      storeGeometry(storageKey, g);
      return g;
    });
  }

  // The browser's own resize handle (CSS `resize: both`) changes the
  // element's size directly; this mirrors that back into state (so the next
  // render doesn't snap it back) and remembers it.
  useEffect(() => {
    const el = paperRef.current;
    if (!el || maximized || minimized) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      setGeometry((g) => {
        if (Math.abs(g.width - width) < 1 && Math.abs(g.height - height) < 1) return g;
        const next = { ...g, width, height };
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => storeGeometry(storageKey, next), 300);
        return next;
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [storageKey, maximized, minimized]);

  return (
    <>
      {minimized && (
        <Paper
          withBorder
          shadow="md"
          radius="sm"
          style={{ position: "fixed", bottom: 0, right: chipRight, width: chipWidth, zIndex }}
        >
          <Group gap={6} wrap="nowrap" px="sm" py={6} style={{ background: "var(--mantine-color-default-hover)" }}>
            <UnstyledButton onClick={() => onMinimize(false)} style={{ minWidth: 0, flex: 1 }} title={t("Show")}>
              <Group gap={6} wrap="nowrap">
                <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                  {title}
                </Text>
                {chipStatus}
              </Group>
            </UnstyledButton>
            <CircleGlyphButton glyph="▴" label={t("Show")} onClick={() => onMinimize(false)} size={18} />
            <CircleGlyphButton glyph="×" label={t("Close")} onClick={onClose} size={18} />
          </Group>
        </Paper>
      )}
      <Paper
        ref={paperRef}
        withBorder
        shadow="lg"
        radius="sm"
        role="dialog"
        aria-label={title}
        onPointerDownCapture={onFocus}
        style={{
          position: "fixed",
          zIndex,
          display: minimized ? "none" : "flex",
          flexDirection: "column",
          overflow: "hidden",
          ...(maximized
            ? { left: "3vw", top: "3vh", width: "94vw", height: "94vh" }
            : {
                left: geometry.left,
                top: geometry.top,
                width: geometry.width,
                height: geometry.height,
                resize: "both",
                minWidth: MIN_WIDTH,
                minHeight: MIN_HEIGHT,
              }),
        }}
      >
        <Group
          gap={6}
          wrap="nowrap"
          justify="space-between"
          px="sm"
          py={6}
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
          onPointerCancel={onTitlePointerUp}
          onDoubleClick={() => setMaximized((m) => !m)}
          style={{
            flex: "none",
            cursor: maximized ? undefined : "move",
            userSelect: "none",
            touchAction: "none",
            background: "var(--mantine-color-default-hover)",
            borderBottom: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <Text fw={600} size="sm" truncate style={{ minWidth: 0, flex: 1 }}>
            {title}
          </Text>
          {titleExtra}
          <Group gap={2} wrap="nowrap">
            {headerButtons}
            <CircleGlyphButton glyph="▾" label={t("Minimize")} onClick={() => onMinimize(true)} size={18} />
            <CircleGlyphButton
              glyph={maximized ? "⤡" : "⤢"}
              label={maximized ? t("Restore size") : t("Maximize")}
              onClick={() => setMaximized((m) => !m)}
              size={18}
            />
            <CircleGlyphButton glyph="×" label={t("Close")} onClick={onClose} size={18} />
          </Group>
        </Group>
        <Box p="sm" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {children}
        </Box>
      </Paper>
    </>
  );
}
