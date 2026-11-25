// The corkboard skin: each kind of record is a different piece of paper,
// held by a pin in its record type's colour (a paperclip while it's a draft
// not saved yet), with yarn sagging between pins. Ported from the prototype.
import { SNAPSHOT_H, SNAPSHOT_W } from "../placeMapSnapshot";
import { retryApiImageOnError } from "../../../store/apiImage";
import type { ReactNode } from "react";
import type { GrampsClass } from "../../../store/board/records";
import type { BoardSkin, CardBox, CardView, YarnDrawing } from "../skin";
import css from "./corkboard.module.css";

const COMPACT: Record<GrampsClass, [number, number]> = {
  Person: [150, 178],
  Family: [206, 124],
  Event: [214, 132],
  Place: [192, 120],
  Source: [180, 150],
  Citation: [202, 118],
  Repository: [206, 118],
  Media: [180, 166],
  Note: [182, 136],
};
const PHOTO_H: Partial<Record<GrampsClass, number>> = { Person: 112, Media: 104 };
const KICKER: Partial<Record<GrampsClass, string>> = {
  Family: "FAMILY GROUP SHEET",
  Place: "PLACE",
  Source: "SOURCE",
  Citation: "CITATION",
  Repository: "REPOSITORY",
};
const PIN_COLOR: Record<GrampsClass, string> = {
  Person: "#d83f36",
  Family: "#8d4aab",
  Event: "#e3801f",
  Place: "#2b9a5b",
  Source: "#8a5a2c",
  Citation: "#6f7d84",
  Repository: "#17907c",
  Media: "#c2266a",
  Note: "#cfa40c",
};
const GLYPH: Record<GrampsClass, string> = {
  Person: "M0-8a4 4 0 1 1 0 8a4 4 0 1 1 0-8zM-7 8a7 6 0 0 1 14 0z",
  Family: "M-4-7a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 1 1 0-6.4zM5-6a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 1 1 0-5.6zM-10 8a6 5.5 0 0 1 12 0zM0 8a5 5 0 0 1 10 0z",
  Event: "M-7-6h14v13h-14zM-7-2h14M-3.5-8v4M3.5-8v4",
  Place: "M0 9C-4 4-6 1-6-2a6 6 0 0 1 12 0c0 3-2 6-6 11z",
  Source: "M-8-6h6a2 2 0 0 1 2 2v11a2 2 0 0 0-2-1.5h-6zM8-6h-6a2 2 0 0 0-2 2v11a2 2 0 0 1 2-1.5h6z",
  Citation: "M-6 5v-4a4 4 0 0 1 4-4M2 5v-4a4 4 0 0 1 4-4",
  Repository: "M-8 7h16M-6 6v-7M-2 6v-7M2 6v-7M6 6v-7M-8-2h16L0-8z",
  Media: "M-7-6h14v12h-14zM-6 5l4-5 3 3 2-2 4 4",
  Note: "M-6-7h9l4 4v10h-13zM-3-1h6M-3 3h6",
};

function seedOf(s: string): number {
  let x = 2166136261;
  for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0;
  return x;
}
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  if (out.length > lines) {
    const cut = out.slice(0, lines);
    cut[lines - 1] = fit(`${cut[lines - 1]} …`, max);
    return cut;
  }
  return out;
}

interface Line {
  t: string;
  cls: string;
  y: number;
  x?: number;
  anchor?: "start" | "middle";
}
interface Layout {
  box: CardBox;
  photoH: number;
  lines: Line[];
  rules: number[];
  pad: number;
  icon: boolean;
}

function layout(view: CardView): Layout {
  const cls = view.cls;
  if (view.size === "icon") {
    const w = 96;
    const h = 108;
    const icon = view.cls === "Person" ? view.title.split(" ")[0] : view.cls === "Event" ? view.title.split(" of ")[0] : view.title;
    return {
      box: { w, h, x0: -w / 2, y0: -12 },
      photoH: PHOTO_H[cls] ? 64 : 0,
      lines: [{ t: fit(icon, 12), cls: css.icon, y: -12 + h - 13, x: 0, anchor: "middle" }],
      rules: [],
      pad: 10,
      icon: true,
    };
  }
  const ex = view.size === "expanded";
  const [cw, ch] = COMPACT[cls];
  const w = ex ? 286 : cw;
  const x0 = -w / 2;
  const y0 = -12;
  const pad = cls === "Note" ? 30 : 13;
  // A place with coordinates shows a piece of map at the Dossier size.
  const photoH = PHOTO_H[cls] ? (ex ? 170 : PHOTO_H[cls]!) : cls === "Place" && ex && view.coords ? SNAPSHOT_H : 0;
  const inner = w - pad - 13;
  const lines: Line[] = [];
  const rules: number[] = [];
  let y = y0 + (photoH ? photoH + 12 : cls === "Repository" ? 12 : 8);
  if (KICKER[cls]) {
    y += 15;
    lines.push({ t: KICKER[cls]!, cls: css.kick, y });
  }
  let title = view.title;
  if (cls === "Event") {
    const [head, rest] = view.title.split(/ of (.+)/);
    y += 27;
    lines.push({ t: head.toUpperCase(), cls: css.head, y });
    y += 7;
    rules.push(y);
    title = rest ? `of ${rest}` : "";
  }
  const hand = cls === "Note";
  for (const t of wrap(title, Math.max(8, Math.floor(inner / (hand ? 8 : 8.6))), hand ? (ex ? 12 : 3) : ex ? 3 : 2)) {
    y += hand ? 21 : 18;
    lines.push({ t, cls: hand ? css.hand : css.title, y });
  }
  if (view.subtitle) {
    y += 16;
    lines.push({ t: fit(view.subtitle, Math.floor(inner / 7)), cls: css.sub, y });
  }
  if (ex && view.details.length) {
    y += 9;
    rules.push(y);
    y += 2;
    for (const d of view.details) {
      for (const t of wrap(d, Math.floor(inner / 6.8), 3)) {
        y += 15;
        lines.push({ t, cls: css.det, y });
      }
    }
  }
  const h = Math.max(ex ? 0 : ch, Math.ceil(y - y0 + 16));
  return { box: { w, h, x0, y0 }, photoH, lines, rules, pad, icon: false };
}

function tornEdge(box: CardBox, seed: number): string {
  const r = rng(seed);
  const { x0, y0, w, h } = box;
  const pts: [number, number][] = [[x0, y0], [x0 + w, y0]];
  for (let y = y0 + 7; y < y0 + h; y += 7) pts.push([x0 + w - r() * 3.5, y]);
  for (let x = x0 + w; x > x0; x -= 6) pts.push([x, y0 + h - r() * 4.5]);
  pts.push([x0, y0 + h]);
  for (let y = y0 + h - 8; y > y0; y -= 9) pts.push([x0 + r() * 2.5, y]);
  return pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}

function Shadow({ box }: { box: CardBox }) {
  const { x0, y0, w, h } = box;
  return (
    <g className={css.shadow}>
      {[[2, 4, 0, 0.32], [4, 7, 3, 0.16], [6, 10, 7, 0.08]].map(([dx, dy, g, op], i) => (
        <rect key={i} x={x0 + dx - g} y={y0 + dy - g} width={w + 2 * g} height={h + 2 * g} rx={2 + g} opacity={op} />
      ))}
    </g>
  );
}

function Paper({ view, l, photoUrl, mapUrl }: { view: CardView; l: Layout; photoUrl: string | null; mapUrl: string | null }) {
  const { x0, y0, w, h } = l.box;
  const cls = view.cls;
  const seed = seedOf(view.handle);
  const r = rng(seed);
  if (cls === "Person" || cls === "Media") {
    const inset = l.icon ? 7 : 9;
    const pw = w - 2 * inset;
    const top = y0 + inset;
    const ph = l.photoH;
    const figure = (cx: number, s: number) => (
      <g key={cx}>
        <circle className={css.photoFig} cx={cx} cy={top + ph * 0.4} r={ph * 0.17 * s} />
        <path
          className={css.photoFig}
          d={`M${cx - pw * 0.33 * s} ${top + ph}Q${cx - pw * 0.3 * s} ${top + ph * 0.62} ${cx} ${top + ph * 0.62}Q${cx + pw * 0.3 * s} ${top + ph * 0.62} ${cx + pw * 0.33 * s} ${top + ph}Z`}
        />
      </g>
    );
    return (
      <>
        <rect className={css.white} x={x0} y={y0} width={w} height={h} rx={1.5} />
        <rect className={css.photoBg} x={x0 + inset} y={top} width={pw} height={ph} />
        {photoUrl ? (
          <image href={photoUrl} x={x0 + inset} y={top} width={pw} height={ph} preserveAspectRatio="xMidYMid slice" onError={(e) => retryApiImageOnError(e.currentTarget)} />
        ) : cls === "Person" ? (
          figure(0, 1)
        ) : (
          [figure(-pw * 0.27, 0.62), figure(pw * 0.27, 0.62), figure(0, 0.7)]
        )}
      </>
    );
  }
  if (l.icon) {
    const fill = { Event: css.news, Place: css.map, Citation: css.index, Repository: css.manila, Family: css.sheet }[cls as string] ?? css.white;
    return (
      <>
        <rect className={fill} x={x0} y={y0} width={w} height={h} rx={1.5} />
        <path d={GLYPH[cls]} transform={`translate(0 ${y0 + 44}) scale(2.1)`} fill="none" stroke={PIN_COLOR[cls]} strokeWidth={1.4} strokeLinejoin="round" />
      </>
    );
  }
  switch (cls) {
    case "Event":
      return (
        <>
          <polygon className={css.news} points={tornEdge(l.box, seed)} />
          {[0, 1, 2].map((i) => (
            <line key={i} className={css.ruleFaint} x1={x0 + 13} x2={x0 + w - 13} y1={y0 + h - 10 - i * 5} y2={y0 + h - 10 - i * 5} />
          ))}
        </>
      );
    case "Place": {
      const ys = [0.25, 0.45, 0.7, 0.88].map((f) => y0 + h * f);
      return (
        <>
          <rect className={css.map} x={x0} y={y0} width={w} height={h} />
          {ys.map((yy, i) => (
            <path key={i} className={css.mapLine} d={`M${x0} ${yy}C${x0 + w * 0.3} ${yy - 12 + r() * 24} ${x0 + w * 0.65} ${yy - 12 + r() * 24} ${x0 + w} ${yy + (r() - 0.5) * 14}`} />
          ))}
          <path className={css.river} d={`M${x0 + w * 0.62} ${y0}C${x0 + w * 0.5} ${y0 + h * 0.35} ${x0 + w * 0.86} ${y0 + h * 0.6} ${x0 + w * 0.74} ${y0 + h}`} />
          {l.photoH > 0 && (() => {
            // A clipping of the real map, centred on the place, with a pin.
            const mx = x0 + (w - SNAPSHOT_W) / 2;
            const my = y0 + 10;
            const cx = mx + SNAPSHOT_W / 2;
            const cy = my + l.photoH / 2;
            return (
              <g>
                <rect className={css.photoBg} x={mx} y={my} width={SNAPSHOT_W} height={l.photoH} />
                {mapUrl && <image href={mapUrl} x={mx} y={my} width={SNAPSHOT_W} height={l.photoH} preserveAspectRatio="xMidYMid slice" />}
                <rect className={css.mapFrame} x={mx} y={my} width={SNAPSHOT_W} height={l.photoH} />
                <path className={css.mapPin} d={`M${cx} ${cy}c-5 -6 -8 -10 -8 -14a8 8 0 0 1 16 0c0 4 -3 8 -8 14z`} />
                <circle className={css.mapPinDot} cx={cx} cy={cy - 14} r={2.6} />
                {mapUrl && <text className={css.mapCredit} x={mx + SNAPSHOT_W - 3} y={my + l.photoH - 3} textAnchor="end">© OpenStreetMap</text>}
              </g>
            );
          })()}
        </>
      );
    }
    case "Source":
      return (
        <>
          <path className={css.white} d={`M${x0} ${y0}H${x0 + w - 18}L${x0 + w} ${y0 + 18}V${y0 + h}H${x0}Z`} />
          <path className={css.news} d={`M${x0 + w - 18} ${y0}V${y0 + 18}H${x0 + w}Z`} />
        </>
      );
    case "Citation":
      return (
        <>
          <rect className={css.index} x={x0} y={y0} width={w} height={h} />
          <line className={css.ruleRed} x1={x0} x2={x0 + w} y1={y0 + 31} y2={y0 + 31} />
          {Array.from({ length: Math.max(0, Math.floor((h - 40) / 18)) }, (_, i) => (
            <line key={i} className={css.ruleBlue} x1={x0} x2={x0 + w} y1={y0 + 49 + i * 18} y2={y0 + 49 + i * 18} />
          ))}
        </>
      );
    case "Repository":
      return (
        <>
          <path className={css.manilaDark} d={`M${x0 + 10} ${y0 + 2}V${y0 - 6}q0 -6 6 -6h60q6 0 8 6l3 8z`} />
          <rect className={css.manila} x={x0} y={y0 + 2} width={w} height={h - 2} rx={2} />
        </>
      );
    case "Note":
      return (
        <>
          <rect className={css.white} x={x0} y={y0} width={w} height={h} />
          {Array.from({ length: Math.max(0, Math.floor((h - 18) / 21)) }, (_, i) => (
            <line key={i} className={css.ruleBlue} x1={x0} x2={x0 + w} y1={y0 + 34 + i * 21} y2={y0 + 34 + i * 21} />
          ))}
          <line className={css.ruleRed} x1={x0 + 23} x2={x0 + 23} y1={y0} y2={y0 + h} />
          {[0.2, 0.5, 0.8].map((f) => (
            <circle key={f} className={css.hole} cx={x0 + 10} cy={y0 + h * f} r={3.3} />
          ))}
        </>
      );
    case "Family":
      return (
        <>
          <rect className={css.sheet} x={x0} y={y0} width={w} height={h} />
          <rect className={css.news} x={x0} y={y0} width={w} height={30} />
          {Array.from({ length: Math.max(0, Math.floor((h - 40) / 18)) }, (_, i) => (
            <line key={i} className={css.ruleFaint} x1={x0 + 8} x2={x0 + w - 8} y1={y0 + 48 + i * 18} y2={y0 + 48 + i * 18} />
          ))}
        </>
      );
  }
  return <rect className={css.white} x={x0} y={y0} width={w} height={h} />;
}

function markerLoop(box: CardBox): string {
  const cx = box.x0 + box.w / 2;
  const cy = box.y0 + box.h / 2;
  const rx = box.w / 2 + 18;
  const ry = box.h / 2 + 16;
  return `M${cx - rx} ${cy + 4}A${rx} ${ry} 0 1 1 ${cx + rx - 2} ${cy + 6}A${rx} ${ry + 2} 0 0 1 ${cx - rx + 14} ${cy - ry * 0.55}`;
}

/** Cork speckles, the same every time. */
const CORK = (() => {
  const r = rng(42);
  return Array.from({ length: 240 }, () => [r() * 160, r() * 160, 0.6 + r() * 2.3, 0.4 + r() * 1.5, r() < 0.55 ? 1 : 0, 0.25 + r() * 0.5, r() * 180]);
})();

export const corkboardSkin: BoardSkin = {
  key: "corkboard",
  className: css.root,

  cardBox: (view) => layout(view).box,

  renderCard(view, box, { selected, photoUrl, mapUrl }): ReactNode {
    const l = layout(view);
    const { x0, y0, w, h } = box;
    return (
      <>
        <Shadow box={box} />
        <Paper view={view} l={l} photoUrl={photoUrl} mapUrl={mapUrl ?? null} />
        {l.rules.map((y, i) => (
          <line key={`r${i}`} className={css.kRule} x1={x0 + l.pad} x2={x0 + w - 13} y1={y} y2={y} />
        ))}
        {l.lines.map((ln, i) => (
          <text key={i} className={ln.cls} x={ln.x ?? x0 + l.pad} y={ln.y} textAnchor={ln.anchor ?? "start"}>
            {ln.t}
          </text>
        ))}
        {view.unproven && (
          <g className={css.stamp} transform={l.icon ? `translate(0 ${y0 + 62}) rotate(-14) scale(.62)` : `translate(${x0 + w - 62} ${y0 + h - 24}) rotate(-10)`}>
            <rect x={-50} y={-12} width={100} height={24} rx={3} />
            <text textAnchor="middle" y={5}>UNPROVEN</text>
          </g>
        )}
        {view.updated && !l.icon && (
          <text className={css.pencil} x={x0 + w - 12} y={y0 + 16} textAnchor="end">updated</text>
        )}
        {view.undated && (
          <text className={css.pencil} x={x0 + w - 10} y={y0 + h - 7} textAnchor="end">{l.icon ? "?" : "date?"}</text>
        )}
        {view.draft && <rect className={css.draftLine} x={x0 - 5} y={y0 - 5} width={w + 10} height={h + 10} rx={3} />}
        {selected && <path className={css.marker} d={markerLoop(box)} />}
      </>
    );
  },

  renderPin(view): ReactNode {
    if (view.draft) {
      const wire = "M-3 10V-12a4.2 4.2 0 0 1 8.4 0V7a2.6 2.6 0 0 1-5.2 0V-8";
      return (
        <g transform="rotate(-9)">
          <path className={css.clipShadow} transform="translate(1.2 1.8)" d={wire} />
          <path className={css.clipWire} d={wire} />
        </g>
      );
    }
    return (
      <>
        <ellipse className={css.pinShadow} cx={4.5} cy={6.5} rx={6.5} ry={3.6} />
        <circle r={7.5} fill={PIN_COLOR[view.cls]} />
        <circle r={7.5} fill="url(#board-pin-shine)" pointerEvents="none" />
        <circle className={css.pinGlint} cx={-2.5} cy={-2.7} r={1.8} />
      </>
    );
  },

  renderYarn({ yarn, d, mx, my, selected, isNew, cut, showTag, ends }: YarnDrawing): ReactNode {
    const tw = yarn.label.length * 6.6 + 26;
    if (cut && ends) {
      // Two halves hanging from their pins, frayed at the cut.
      const dx = ends.x2 - ends.x1;
      const dy = ends.y2 - ends.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const reach = Math.min(80, len * 0.3);
      const half = (x: number, y: number, s: number) => {
        const ex = x + ux * s * reach;
        const ey = y + uy * s * reach + 54;
        return { d: `M${x} ${y}Q${x + ux * s * reach * 0.6} ${y + uy * s * reach * 0.6 + 4} ${ex} ${ey}`, ex, ey };
      };
      const halves = [half(ends.x1, ends.y1, 1), half(ends.x2, ends.y2, -1)];
      const tag = `✂ ${yarn.label}`;
      const cw = tag.length * 6.6 + 26;
      return (
        <g className={[css.yarn, css[yarn.kind], css.cut, selected ? css.selected : ""].join(" ")}>
          <path className={css.yHit} d={d} />
          {halves.map((h, i) => (
            <g key={i}>
              <path className={css.yShadow} d={h.d} transform="translate(1 2.5)" />
              <path className={css.yMain} d={h.d} />
              <path className={css.fray} d={`M${h.ex} ${h.ey}l-3.5 5M${h.ex} ${h.ey}l.5 6.5M${h.ex} ${h.ey}l4 4.5`} />
            </g>
          ))}
          <g className={css.tag} transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)})`}>
            <rect className={css.tagPaper} x={-cw / 2} y={-10} width={cw} height={20} rx={3} />
            <text x={0} y={5} textAnchor="middle">{tag}</text>
          </g>
        </g>
      );
    }
    return (
      <g className={[css.yarn, css[yarn.kind], isNew ? css.isNew : "", selected ? css.selected : ""].join(" ")}>
        <path className={`yp ${css.yHit}`} d={d} />
        <path className={`yp ${css.yShadow}`} d={d} transform="translate(1 2.5)" />
        <path className={`yp ${css.yMain}`} d={d} />
        <path className={`yp ${css.yFiber}`} d={d} />
        {showTag && (
          <g className={`ytag ${css.tag}`} transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)})`}>
            <rect className={css.tagShadow} x={-tw / 2 + 1.5} y={-7.5} width={tw} height={20} rx={3} />
            <rect className={css.tagPaper} x={-tw / 2} y={-10} width={tw} height={20} rx={3} />
            <circle cx={-tw / 2 + 7} cy={0} r={2.2} />
            <text x={5} y={5} textAnchor="middle">{yarn.label}</text>
          </g>
        )}
      </g>
    );
  },

  renderBackground(): ReactNode {
    return (
      <>
        <defs>
          <pattern id="board-cork" width={160} height={160} patternUnits="userSpaceOnUse">
            <rect width={160} height={160} fill="var(--cork)" />
            {CORK.map(([x, y, rx, ry, dark, op, rot], i) => (
              <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill={dark ? "var(--cork-dark)" : "var(--cork-light)"} opacity={op} transform={`rotate(${rot} ${x} ${y})`} />
            ))}
          </pattern>
          <radialGradient id="board-pin-shine" cx="35%" cy="32%" r="65%">
            <stop offset="0" stopColor="#fff" stopOpacity={0.75} />
            <stop offset="0.45" stopColor="#fff" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.35} />
          </radialGradient>
          <linearGradient id="board-sepia" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sepia-1)" />
            <stop offset="1" stopColor="var(--sepia-2)" />
          </linearGradient>
        </defs>
        <rect data-board-background x={-20000} y={-20000} width={40000} height={40000} fill="url(#board-cork)" />
      </>
    );
  },

  renderLighting(): ReactNode {
    // A lamp over the upper left (only shows at night) and the board's edges
    // falling into shade, as in the prototype.
    return (
      <g pointerEvents="none">
        <defs>
          <radialGradient id="board-lamp" cx="38%" cy="34%" r="60%">
            <stop offset="0" className={css.lampStop} />
            <stop offset="0.7" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="board-vignette" cx="50%" cy="50%" r="75%">
            <stop offset="0.55" stopOpacity={0} />
            <stop offset="1" className={css.vignetteStop} />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#board-lamp)" />
        <rect width="100%" height="100%" fill="url(#board-vignette)" />
      </g>
    );
  },

  renderPull(d: string): ReactNode {
    return <path className={css.pull} d={d} />;
  },
};

export const LIFTED_CLASS = css.lifted;
