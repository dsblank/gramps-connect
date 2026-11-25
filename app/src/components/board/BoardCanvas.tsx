// The Evidence Board's drawing surface: an SVG with zoom and pan (d3-zoom),
// drawing yarn, cards and pins through the board's skin (skin.ts), in the
// order a corkboard has them: cards, then the yarn over them, then the pins
// the yarn is tied to. A card being dragged is lifted above the yarn's
// pins... but under the yarn itself, so it stays visibly tied.
//
// It reports what the user does (select, move, resize, pull yarn) and keeps
// no board state of its own beyond the drag in progress and the view.
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../../i18n/i18n";
import type { Yarn } from "../../store/board/view";
import { BoardPhysics, jiggle, swingTransform, yarnPath, type YarnGeometry } from "./physics";
import type { BoardSkin, CardBox, CardView } from "./skin";
import { LIFTED_CLASS } from "./corkboard/corkboardSkin";

export interface Point {
  x: number;
  y: number;
}

export type BoardSelection = { kind: "card"; id: string } | { kind: "yarn"; id: string } | null;

export interface BoardCanvasHandle {
  fit: () => void;
  /** The board point at the middle of what's on screen. */
  center: () => Point;
  /** Pans and zooms out just enough to show `handles` (no-op if they're
   * already in view). */
  reveal: (handles: string[]) => void;
}

interface Props {
  skin: BoardSkin;
  cards: CardView[];
  positions: Record<string, Point>;
  yarn: Yarn[];
  /** Yarn added on this board and not saved yet (drawn dashed). */
  newYarn: Set<string>;
  /** Yarn snipped on this board and not saved yet (drawn cut). */
  cutYarn?: Yarn[];
  photoUrls: Record<string, string | null>;
  selection: BoardSelection;
  onSelect: (selection: BoardSelection) => void;
  /** A card moved; `done` on the drop. */
  onMove: (handle: string, to: Point, done: boolean) => void;
  onCycleSize: (handle: string) => void;
  /** Yarn pulled from `from`'s pin and let go over card `to` (or empty board, null). */
  onPull?: (from: string, to: string | null, at: Point, screen: Point) => void;
  /** Receives the canvas's commands (fit). */
  canvasRef?: (handle: BoardCanvasHandle | null) => void;
}

const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function BoardCanvas(props: Props) {
  const { skin, cards, positions, yarn, newYarn, cutYarn = [], photoUrls, selection, onSelect, onMove, onCycleSize, onPull, canvasRef } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [view, setView] = useState<ZoomTransform>(zoomIdentity.translate(80, 90));
  const viewRef = useRef(view);
  viewRef.current = view;
  const physics = useMemo(() => new BoardPhysics(reduceMotion), []);
  useEffect(() => () => physics.stop(), [physics]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pull, setPull] = useState<{ from: string; to: Point } | null>(null);

  const boxes = useMemo(() => Object.fromEntries(cards.map((c) => [c.handle, skin.cardBox(c)])), [cards, skin]);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  // New cards drop in and swing.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Set(cards.map((c) => c.handle));
    for (const h of now) if (seen.current && !seen.current.has(h)) physics.dropIn(h);
    seen.current = now;
  }, [cards, physics]);

  // Zoom and pan: wheel anywhere; drag only on the empty board.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 2.5])
      .extent((): [[number, number], [number, number]] => {
        const r = svg.getBoundingClientRect();
        return [[0, 0], [r.width || 1, r.height || 1]];
      })
      .filter((e: Event) => e.type === "wheel" || (!(e.target as Element).closest("[data-nozoom]") && !(e as MouseEvent).button && !(e as MouseEvent).ctrlKey))
      .on("zoom", (e: { transform: ZoomTransform }) => setView(e.transform));
    select(svg).call(z).on("dblclick.zoom", null);
    select(svg).call(z.transform, viewRef.current);
    zoomRef.current = z;
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    const handles = Object.keys(positionsRef.current).filter((h) => boxesRef.current[h]);
    if (!svg || !z || !handles.length) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    const u = handles.reduce(
      (a, h) => {
        const p = positionsRef.current[h];
        const b = boxesRef.current[h];
        return [Math.min(a[0], p.x + b.x0), Math.min(a[1], p.y + b.y0 - 8), Math.max(a[2], p.x + b.x0 + b.w), Math.max(a[3], p.y + b.y0 + b.h)];
      },
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const pad = 48;
    const k = Math.min(1.25, (r.width - 2 * pad) / (u[2] - u[0]), (r.height - 2 * pad) / (u[3] - u[1]));
    const cx = (u[0] + u[2]) / 2;
    const cy = (u[1] + u[3]) / 2;
    select(svg).transition().duration(450).call(z.transform, zoomIdentity.translate(r.width / 2 - cx * k, r.height / 2 - cy * k).scale(k));
  }, []);

  const center = useCallback((): Point => {
    const r = svgRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!r) return { x: 0, y: 0 };
    return { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - 60 - v.y) / v.k };
  }, []);

  const reveal = useCallback((handles: string[]) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    const r = svg.getBoundingClientRect();
    const v = viewRef.current;
    const boxes = handles
      .filter((h) => positionsRef.current[h] && boxesRef.current[h])
      .map((h) => {
        const p = positionsRef.current[h];
        const b = boxesRef.current[h];
        return [p.x + b.x0, p.y + b.y0 - 8, p.x + b.x0 + b.w, p.y + b.y0 + b.h];
      });
    if (!boxes.length || r.width < 50) return;
    const m = 30 / v.k;
    const view = [-v.x / v.k, -v.y / v.k, (r.width - v.x) / v.k, (r.height - v.y) / v.k];
    if (boxes.every((b) => b[0] >= view[0] + m && b[1] >= view[1] + m && b[2] <= view[2] - m && b[3] <= view[3] - m)) return;
    const u = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], view);
    const k = Math.min(v.k, r.width / (u[2] - u[0] + 120 / v.k), r.height / (u[3] - u[1] + 120 / v.k));
    select(svg).transition().duration(450).call(z.transform, zoomIdentity.translate(r.width / 2 - ((u[0] + u[2]) / 2) * k, r.height / 2 - ((u[1] + u[3]) / 2) * k).scale(k));
  }, []);

  useEffect(() => {
    canvasRef?.({ fit, center, reveal });
    return () => canvasRef?.(null);
  }, [canvasRef, fit, center, reveal]);

  // Fit once the board has a real size (it can start at 0x0 in a layout
  // that's still settling), and once cards have arrived.
  const fitted = useRef(false);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      if (fitted.current || r.width < 50 || r.height < 50 || !Object.keys(positionsRef.current).length) return;
      fitted.current = true;
      setTimeout(fit, 60);
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fit]);
  useEffect(() => {
    if (!fitted.current && Object.keys(positions).length && svgRef.current && svgRef.current.getBoundingClientRect().width > 50) {
      fitted.current = true;
      setTimeout(fit, 60);
    }
  }, [positions, fit]);

  const toBoard = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  const cardAt = (p: Point, except: string): string | null => {
    for (const [h, pos] of Object.entries(positionsRef.current)) {
      const b = boxesRef.current[h];
      if (h === except || !b) continue;
      if (p.x >= pos.x + b.x0 && p.x <= pos.x + b.x0 + b.w && p.y >= pos.y + b.y0 - 8 && p.y <= pos.y + b.y0 + b.h) return h;
    }
    return null;
  };

  const onCardDown = (e: ReactPointerEvent, handle: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const from = positionsRef.current[handle];
    let moved = false;
    let last = { x: e.clientX, t: performance.now() };
    let vx = 0;
    let at = from;
    const attached = yarn.filter((y) => y.a === handle || y.b === handle).map((y) => y.id);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        physics.startDrag(handle);
        setDragging(handle);
      }
      const now = performance.now();
      vx = vx * 0.6 + ((ev.clientX - last.x) / Math.max(8, now - last.t)) * 1000 * 0.4;
      last = { x: ev.clientX, t: now };
      physics.dragSpeed(handle, vx);
      for (const id of attached) physics.kickYarn(id, Math.max(-25, Math.min(25, Math.abs(vx) * 0.005)));
      const k = viewRef.current.k;
      at = { x: from.x + dx / k, y: from.y + dy / k };
      onMove(handle, at, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) {
        onSelect({ kind: "card", id: handle });
        physics.kickCard(handle, jiggle(40));
        return;
      }
      physics.endDrag(handle, vx);
      setDragging(null);
      for (const [other, p] of Object.entries(positionsRef.current)) {
        if (other !== handle && Math.hypot(p.x - at.x, p.y - at.y) < 330) physics.kickCard(other, jiggle(22));
      }
      for (const id of attached) physics.kickYarn(id, 70);
      onMove(handle, at, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPinDown = (e: ReactPointerEvent, handle: string) => {
    if (e.button !== 0 || !onPull) {
      onCardDown(e, handle);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    const start = toBoard(e.clientX, e.clientY);
    setPull({ from: handle, to: start });
    const move = (ev: PointerEvent) => setPull({ from: handle, to: toBoard(ev.clientX, ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPull(null);
      const end = toBoard(ev.clientX, ev.clientY);
      if (Math.hypot(end.x - start.x, end.y - start.y) < 8) {
        onSelect({ kind: "card", id: handle });
        return;
      }
      const r = svgRef.current!.getBoundingClientRect();
      physics.kickCard(handle, jiggle(50));
      const target = cardAt(end, handle);
      if (target) physics.kickCard(target, jiggle(50));
      onPull(handle, target, end, { x: ev.clientX - r.left, y: ev.clientY - r.top });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- drawing -----------------------------------------------------------------
  const showTags = view.k >= 0.5;
  const pairCount: Record<string, number> = {};
  const yarnEls = yarn.map((y) => {
    const A = positions[y.a];
    const B = positions[y.b];
    if (!A || !B) return null;
    const pair = [y.a, y.b].sort().join("|");
    const i = (pairCount[pair] = (pairCount[pair] ?? 0) + 1) - 1;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 26;
    const g: YarnGeometry = { x1: A.x, y1: A.y, x2: B.x, y2: B.y, ox: (-dy / len) * off, oy: (dx / len) * off, sag: Math.min(70, 8 + len * 0.09) };
    const { d, mx, my } = yarnPath(g, physics.wobble(y.id));
    const selected = selection?.kind === "yarn" && selection.id === y.id;
    const touchesSelected = selection?.kind === "card" && (selection.id === y.a || selection.id === y.b);
    return (
      <g
        key={y.id}
        ref={(el) => physics.attachYarn(y.id, el, g)}
        data-nozoom
        style={{ cursor: "pointer" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          onSelect({ kind: "yarn", id: y.id });
          physics.kickYarn(y.id, 80);
        }}
      >
        {skin.renderYarn({ yarn: { ...y, label: t(y.label) }, d, mx, my, selected, isNew: newYarn.has(y.id), cut: false, showTag: showTags || selected || touchesSelected })}
      </g>
    );
  });
  const cutEls = cutYarn.map((y) => {
    const A = positions[y.a];
    const B = positions[y.b];
    if (!A || !B) return null;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const { d, mx, my } = yarnPath({ x1: A.x, y1: A.y, x2: B.x, y2: B.y, ox: 0, oy: 0, sag: Math.min(70, 8 + len * 0.09) });
    const selected = selection?.kind === "yarn" && selection.id === y.id;
    return (
      <g key={`cut-${y.id}`} data-nozoom style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect({ kind: "yarn", id: y.id })}>
        {skin.renderYarn({ yarn: { ...y, label: t(y.label) }, d, mx, my, selected, isNew: false, cut: true, showTag: true, ends: { x1: A.x, y1: A.y, x2: B.x, y2: B.y } })}
      </g>
    );
  });

  const cardEl = (c: CardView) => {
    const p = positions[c.handle];
    const box: CardBox | undefined = boxes[c.handle];
    if (!p || !box) return null;
    const selected = selection?.kind === "card" && selection.id === c.handle;
    return (
      <g
        key={c.handle}
        className={dragging === c.handle ? LIFTED_CLASS : undefined}
        transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
        data-nozoom
        data-card={c.handle}
        style={{ cursor: dragging === c.handle ? "grabbing" : "grab" }}
        onPointerDown={(e) => onCardDown(e, c.handle)}
        onDoubleClick={() => {
          onCycleSize(c.handle);
          physics.kickCard(c.handle, jiggle(70), 1.2);
        }}
      >
        <g ref={(el) => physics.attachCard(c.handle, el)} transform={swingTransform(physics.card(c.handle))}>
          {skin.renderCard(c, box, { selected, photoUrl: photoUrls[c.handle] ?? null })}
        </g>
      </g>
    );
  };
  const pinEl = (c: CardView) => {
    const p = positions[c.handle];
    if (!p) return null;
    return (
      <g
        key={`pin-${c.handle}`}
        transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
        data-nozoom
        style={{ cursor: onPull ? "crosshair" : "grab" }}
        onPointerDown={(e) => onPinDown(e, c.handle)}
      >
        <title>{t("Drag from here to tie yarn to another card")}</title>
        <circle r={16} fill="transparent" />
        {skin.renderPin(c)}
      </g>
    );
  };

  const still = cards.filter((c) => c.handle !== dragging);
  const lifted = cards.find((c) => c.handle === dragging);
  let pullEl = null;
  if (pull && positions[pull.from]) {
    const p = positions[pull.from];
    const len = Math.hypot(pull.to.x - p.x, pull.to.y - p.y);
    pullEl = skin.renderPull(yarnPath({ x1: p.x, y1: p.y, x2: pull.to.x, y2: pull.to.y, ox: 0, oy: 0, sag: Math.min(60, 4 + len * 0.08) }).d);
  }

  return (
    <svg
      ref={svgRef}
      className={skin.className}
      style={{ width: "100%", height: "100%", display: "block", userSelect: "none", touchAction: "none" }}
      onClick={(e) => {
        if (e.target === svgRef.current || (e.target as Element).hasAttribute("data-board-background")) onSelect(null);
      }}
    >
      <g transform={view.toString()}>{skin.renderBackground()}</g>
      {skin.renderLighting?.()}
      <g transform={view.toString()}>
        {still.map(cardEl)}
        {lifted && cardEl(lifted)}
        <g>{yarnEls}{cutEls}</g>
        {still.map(pinEl)}
        {lifted && pinEl(lifted)}
        {pullEl}
      </g>
    </svg>
  );
}
