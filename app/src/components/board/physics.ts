// Motion on the Evidence Board: every card hangs from its pin like a
// pendulum and every piece of yarn is a spring (ported from the prototype).
// One requestAnimationFrame loop runs only while something moves, and it
// writes transforms and path data straight onto the SVG elements, so a
// swinging card never re-renders React.
//
// Rules learned in the prototype:
// - No CSS/SVG filters on anything that moves: Chrome leaves stale paint
//   behind. Skins draw shadows as shapes.
// - Respect prefers-reduced-motion: then nothing swings or wobbles.

export interface CardMotion {
  /** Current angle, degrees. */
  a: number;
  v: number;
  /** Extra scale (lift when picked up, a press when dropped). */
  s: number;
  sv: number;
  /** Resting tilt: every card hangs a little crooked, by its handle. */
  rest: number;
  drag: boolean;
  /** Angle the card swings towards while dragged (from the drag speed). */
  target: number;
}

export interface YarnGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Sideways offset of the curve's control point (parallel yarn). */
  ox: number;
  oy: number;
  /** How far the yarn sags at rest. */
  sag: number;
}

function seedOf(s: string): number {
  let x = 2166136261;
  for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0;
  return x;
}

/** -2.5 to 2.5 degrees, the same for a handle every time. */
export function restTilt(handle: string): number {
  return ((seedOf(handle) % 1000) / 1000 - 0.5) * 5;
}

export function swingTransform(c: CardMotion): string {
  return `rotate(${c.a.toFixed(2)}) scale(${(1 + c.s).toFixed(4)})`;
}

/** A quadratic curve from pin to pin, sagging under its own weight plus
 * `wobble`. Also returns the curve's midpoint, for the yarn's tag. */
export function yarnPath(g: YarnGeometry, wobble = 0): { d: string; mx: number; my: number } {
  const cx = (g.x1 + g.x2) / 2 + g.ox;
  const cy = (g.y1 + g.y2) / 2 + g.oy + 2 * (g.sag + wobble);
  return {
    d: `M${g.x1.toFixed(1)} ${g.y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${g.x2.toFixed(1)} ${g.y2.toFixed(1)}`,
    mx: (g.x1 + 2 * cx + g.x2) / 4,
    my: (g.y1 + 2 * cy + g.y2) / 4,
  };
}

export class BoardPhysics {
  readonly cards = new Map<string, CardMotion>();
  private readonly yarn = new Map<string, { w: number; v: number }>();
  private readonly cardEls = new Map<string, SVGGElement>();
  private readonly yarnEls = new Map<string, SVGGElement>();
  private readonly geometry = new Map<string, YarnGeometry>();
  private raf = 0;
  private last = 0;

  constructor(private readonly reduceMotion: boolean) {}

  card(handle: string): CardMotion {
    let c = this.cards.get(handle);
    if (!c) {
      const rest = restTilt(handle);
      c = { a: rest, v: 0, s: 0, sv: 0, rest, drag: false, target: 0 };
      this.cards.set(handle, c);
    }
    return c;
  }

  wobble(id: string): number {
    return this.yarn.get(id)?.w ?? 0;
  }

  /** The element a card's swing is written to (its inner group). */
  attachCard(handle: string, el: SVGGElement | null): void {
    if (el) this.cardEls.set(handle, el);
    else this.cardEls.delete(handle);
  }

  /** A piece of yarn's group and where it hangs: its paths (class "yp")
   * and tag (class "ytag") are moved as it wobbles. */
  attachYarn(id: string, el: SVGGElement | null, geometry: YarnGeometry): void {
    this.geometry.set(id, geometry);
    if (el) this.yarnEls.set(id, el);
    else this.yarnEls.delete(id);
  }

  /** Sets a card swinging (degrees per second) and/or bouncing. */
  kickCard(handle: string, dv: number, ds = 0): void {
    const c = this.card(handle);
    c.v += dv;
    c.sv += ds;
    this.wake();
  }

  kickYarn(id: string, dv: number): void {
    const y = this.yarn.get(id) ?? { w: 0, v: 0 };
    y.v += dv;
    this.yarn.set(id, y);
    this.wake();
  }

  /** A card just appeared: it drops in and swings. */
  dropIn(handle: string): void {
    const c = this.card(handle);
    c.s = 0.16;
    c.v += jiggle(110);
    this.wake();
  }

  startDrag(handle: string): void {
    this.card(handle).drag = true;
    this.wake();
  }

  /** Swing against the direction of travel (`vx`, px/s on screen). */
  dragSpeed(handle: string, vx: number): void {
    this.card(handle).target = Math.max(-16, Math.min(16, -vx * 0.022));
    this.wake();
  }

  endDrag(handle: string, vx: number): void {
    const c = this.card(handle);
    c.drag = false;
    c.v += (vx > 0 ? -1 : 1) * Math.min(120, 30 + Math.abs(vx) * 0.05);
    c.sv -= 0.5;
    this.wake();
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private wake(): void {
    if (this.reduceMotion || this.raf || typeof requestAnimationFrame === "undefined") return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private drawYarn(id: string): void {
    const el = this.yarnEls.get(id);
    const g = this.geometry.get(id);
    if (!el || !g || !el.isConnected) return;
    const { d, mx, my } = yarnPath(g, this.wobble(id));
    el.querySelectorAll("path.yp").forEach((p) => p.setAttribute("d", d));
    const tag = el.querySelector(".ytag");
    if (tag) tag.setAttribute("transform", `translate(${mx.toFixed(1)} ${my.toFixed(1)})`);
  }

  private readonly tick = (now: number): void => {
    const dt = Math.min(0.032, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    let busy = false;
    for (const [h, c] of this.cards) {
      const goal = c.drag ? c.target : c.rest;
      const sGoal = c.drag ? 0.045 : 0;
      const settled = Math.abs(c.a - goal) < 0.03 && Math.abs(c.v) < 0.3 && Math.abs(c.s - sGoal) < 0.0006 && Math.abs(c.sv) < 0.004;
      if (!c.drag && settled) {
        if (c.a !== goal || c.s !== sGoal) {
          Object.assign(c, { a: goal, v: 0, s: sGoal, sv: 0 });
          this.cardEls.get(h)?.setAttribute("transform", swingTransform(c));
        }
        continue;
      }
      busy = true;
      for (let i = 0; i < 3; i++) {
        const d = dt / 3;
        c.v += (-150 * (c.a - goal) - 3.4 * c.v) * d;
        c.a += c.v * d;
        c.sv += (-520 * (c.s - sGoal) - 15 * c.sv) * d;
        c.s += c.sv * d;
      }
      this.cardEls.get(h)?.setAttribute("transform", swingTransform(c));
    }
    for (const [id, y] of this.yarn) {
      if (Math.abs(y.w) < 0.05 && Math.abs(y.v) < 0.5) {
        if (y.w !== 0 || y.v !== 0) {
          y.w = 0;
          y.v = 0;
          this.drawYarn(id);
        }
        continue;
      }
      busy = true;
      for (let i = 0; i < 3; i++) {
        const d = dt / 3;
        y.v += (-75 * y.w - 2.4 * y.v) * d;
        y.w += y.v * d;
      }
      this.drawYarn(id);
    }
    this.raf = busy ? requestAnimationFrame(this.tick) : 0;
  };
}

/** A random push of about `n`, either way. */
export function jiggle(n: number): number {
  return (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.4) * n;
}
