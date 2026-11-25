// "Clean up" on the Evidence Board: straightens the cards onto a grid near
// where they already are, then packs them together by closing up empty rows
// and columns. Cards keep their rough arrangement (who's left of whom,
// who's above whom), so a board the user has laid out still reads the same.
import type { CardBox } from "./skin";

/** The grid's step. Cards span as many cells as their outline needs. */
export const CELL_W = 140;
export const CELL_H = 125;
/** Space kept between cards, inside the cells they span. */
const GAP = 22;

export interface CleanUpItem {
  handle: string;
  /** The pin's position. */
  x: number;
  y: number;
  /** The card's outline, relative to its pin. */
  box: CardBox;
}

/** New pin positions for every card. */
export function cleanUp(items: CleanUpItem[]): Record<string, { x: number; y: number }> {
  const taken = new Set<string>();
  const key = (c: number, r: number) => `${c},${r}`;
  const placed: { handle: string; col: number; row: number; sw: number; sh: number; box: CardBox }[] = [];

  // Top-left first, so the ones at the top of the board keep their spots.
  const order = [...items].sort((a, b) => a.y + a.box.y0 - (b.y + b.box.y0) || a.x + a.box.x0 - (b.x + b.box.x0));
  for (const item of order) {
    const sw = Math.max(1, Math.ceil((item.box.w + GAP) / CELL_W));
    const sh = Math.max(1, Math.ceil((item.box.h + GAP) / CELL_H));
    const want = { col: Math.round((item.x + item.box.x0) / CELL_W), row: Math.round((item.y + item.box.y0) / CELL_H) };
    const free = (c: number, r: number) => {
      for (let i = 0; i < sw; i++) for (let j = 0; j < sh; j++) if (taken.has(key(c + i, r + j))) return false;
      return true;
    };
    // The nearest free spot, searched outwards in rings.
    let spot = want;
    search: for (let ring = 0; ring < 200; ring++) {
      const ringSpots: { col: number; row: number; d: number }[] = [];
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          ringSpots.push({ col: want.col + dc, row: want.row + dr, d: dc * dc * CELL_W * CELL_W + dr * dr * CELL_H * CELL_H });
        }
      }
      ringSpots.sort((a, b) => a.d - b.d);
      for (const s of ringSpots) {
        if (free(s.col, s.row)) {
          spot = s;
          break search;
        }
      }
    }
    for (let i = 0; i < sw; i++) for (let j = 0; j < sh; j++) taken.add(key(spot.col + i, spot.row + j));
    placed.push({ handle: item.handle, col: spot.col, row: spot.row, sw, sh, box: item.box });
  }

  // Pack: drop columns and rows no card covers.
  const usedCols = new Set<number>();
  const usedRows = new Set<number>();
  for (const p of placed) {
    for (let i = 0; i < p.sw; i++) usedCols.add(p.col + i);
    for (let j = 0; j < p.sh; j++) usedRows.add(p.row + j);
  }
  const squeeze = (used: Set<number>) => {
    const sorted = [...used].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const map = new Map<number, number>();
    sorted.forEach((v, i) => map.set(v, min + i));
    return map;
  };
  const colOf = squeeze(usedCols);
  const rowOf = squeeze(usedRows);

  const out: Record<string, { x: number; y: number }> = {};
  for (const p of placed) {
    // The card's outline is centred in the cells it spans.
    const left = colOf.get(p.col)! * CELL_W + (p.sw * CELL_W - p.box.w) / 2;
    const top = rowOf.get(p.row)! * CELL_H + (p.sh * CELL_H - p.box.h) / 2;
    out[p.handle] = { x: left - p.box.x0, y: top - p.box.y0 };
  }
  return out;
}
