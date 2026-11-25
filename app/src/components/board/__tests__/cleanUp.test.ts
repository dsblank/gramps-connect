import { describe, expect, it } from "vitest";
import { cleanUp, type CleanUpItem } from "../cleanUp";

const card = { w: 220, h: 200, x0: -110, y0: -12 };
const dossier = { w: 320, h: 380, x0: -160, y0: -12 };
const item = (handle: string, x: number, y: number, box = card): CleanUpItem => ({ handle, x, y, box });

/** Outlines of the cleaned-up cards, for overlap checks. */
function outlines(items: CleanUpItem[], pos: Record<string, { x: number; y: number }>) {
  return items.map((i) => ({ h: i.handle, l: pos[i.handle].x + i.box.x0, t: pos[i.handle].y + i.box.y0, r: pos[i.handle].x + i.box.x0 + i.box.w, b: pos[i.handle].y + i.box.y0 + i.box.h }));
}

describe("Clean up", () => {
  it("separates overlapping cards", () => {
    const items = [item("a", 0, 0), item("b", 30, 20), item("c", 60, 40, dossier), item("d", 10, 300)];
    const boxes = outlines(items, cleanUp(items));
    for (const p of boxes) for (const q of boxes) {
      if (p.h >= q.h) continue;
      const overlap = p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
      expect(overlap, `${p.h} and ${q.h} overlap`).toBe(false);
    }
  });

  it("keeps who's left of whom and who's above whom", () => {
    const items = [item("left", -500, 0), item("right", 900, 40), item("below", 200, 900)];
    const pos = cleanUp(items);
    expect(pos.left.x).toBeLessThan(pos.right.x);
    expect(pos.below.y).toBeGreaterThan(pos.left.y);
  });

  it("packs a spread-out board together", () => {
    const items = [item("a", 0, 0), item("b", 3000, 0), item("c", 0, 3000)];
    const pos = cleanUp(items);
    expect(pos.b.x - pos.a.x).toBeLessThan(400);
    expect(pos.c.y - pos.a.y).toBeLessThan(400);
  });

  it("leaves a tidy board where it is", () => {
    const items = [item("a", 0, 0), item("b", 280, 0)];
    const once = cleanUp(items);
    const twice = cleanUp(items.map((i) => ({ ...i, ...once[i.handle] })));
    expect(twice).toEqual(once);
  });
});
