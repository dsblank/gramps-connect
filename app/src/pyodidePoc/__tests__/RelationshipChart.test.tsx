// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import type { PathLink, PathNode, PathStep, RelationshipPath } from "../../store/relationshipPath";
import { GrampletResultView } from "../GrampletResultView";
import { layoutRelationshipChart } from "../RelationshipChart";

// The local person cache, as readRowByHandle returns it: primary_name and
// the two dates as JSON text.
const ROWS: Record<string, unknown[]> = {
  H: [JSON.stringify({ first_name: "Hal", surname_list: [{ surname: "Home" }] }), JSON.stringify({ dateval: [0, 0, 1971, false], modifier: 0 }), null],
  X: [JSON.stringify({ first_name: "Xena", surname_list: [{ surname: "Cousin" }] }), null, null],
};
// A stable store, like the real registry's: a filter applied or cleared
// on the People list replaces what's cached and bumps `revision`.
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const s = {
    revision: 0,
    ensureLoaded: async () => {},
    readRowByHandle: (handle: string): unknown[] | null => null,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => ({ revision: s.revision }),
    bump: () => {
      s.revision++;
      for (const l of listeners) l();
    },
  };
  return s;
});
store.readRowByHandle = (handle: string) => ROWS[handle] ?? null;
vi.mock("../../store/registry", () => ({ getViewStore: () => store }));

// What the server has for people the cache doesn't: raw query items, not
// yet in the cache's JSON-text form.
const SERVER: Record<string, Record<string, unknown>> = {
  GM: { handle: "GM", primary_name: { first_name: "Gwen", surname_list: [{ surname: "Grand" }] }, birth_date: null, death_date: null },
};
const fetchPage = vi.hoisted(() => vi.fn());
vi.mock("../../store/api", () => ({ fetchPage }));
vi.mock("../../auth/auth", () => ({ getToken: async () => "token" }));
fetchPage.mockImplementation(async (_view: unknown, _token: string, _after: unknown, _count: boolean, where: string) => ({
  page: { items: Object.values(SERVER).filter((item) => where.includes(`'${item.handle}'`)), next_after: null },
  totalCount: null,
}));

const node = (handle: string, label = "", gender = 2): PathNode => ({ handle, relationship_string: label, label, gender });
const step = (handle: string, link: PathLink | null, label = "", extra: Partial<PathStep> = {}): PathStep => ({
  ...node(handle, label),
  link,
  ...extra,
});

/** First cousins once removed through a grandparent couple:
 * H -> A -> GM (⚭ GF) -> B -> C -> X. */
const COUSIN: RelationshipPath = {
  steps: [
    step("H", null),
    step("A", "parent", "mother"),
    step("GM", "parent", "grandmother", { partner: node("GF", "grandfather", 1) }),
    step("B", "child", "uncle"),
    step("C", "child", "first cousin"),
    step("X", "child", "first cousin once removed"),
  ],
};

const CARD_W = 188;
const CARD_H = 76;

function at(cards: { node: { handle: string }; x: number; y: number; label: string; kind: string }[], h: string) {
  const card = cards.find((c) => c.node.handle === h);
  if (!card) throw new Error(`no card for ${h}`);
  return card;
}

/** No two cards overlap. */
function expectNoOverlap(cards: { x: number; y: number }[]) {
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      const [a, b] = [cards[i], cards[j]];
      const apart = Math.abs(a.x - b.x) >= CARD_W || Math.abs(a.y - b.y) >= CARD_H;
      expect(apart, `cards ${i} and ${j} overlap`).toBe(true);
    }
}

describe("layoutRelationshipChart", () => {
  it("puts the couple on top and one leg per side, one row per generation", () => {
    const { cards, rings } = layoutRelationshipChart(COUSIN, "Home person");
    expect(at(cards, "GM").y).toBe(at(cards, "GF").y);
    expect(at(cards, "GM").x).toBeLessThan(at(cards, "GF").x);
    // The left leg (to H) is a row shorter than the right one (to X).
    expect(at(cards, "A").y).toBe(at(cards, "B").y);
    expect(at(cards, "H").y).toBe(at(cards, "C").y);
    expect(at(cards, "X").y).toBeGreaterThan(at(cards, "H").y);
    expect(at(cards, "H").x).toBe(at(cards, "A").x);
    expect(at(cards, "B").x).toBe(at(cards, "X").x);
    expect(at(cards, "H").x).toBeLessThan(at(cards, "X").x);
    expect(rings).toHaveLength(1);
    expect(at(cards, "H").label).toBe("Home person");
    expect([at(cards, "H").kind, at(cards, "X").kind, at(cards, "GM").kind, at(cards, "A").kind]).toEqual(["end", "end", "top", "mid"]);
    expectNoOverlap(cards);
  });

  it("puts a sibling link's parents above the pair", () => {
    const { cards, rings } = layoutRelationshipChart(
      {
        steps: [
          step("H", null),
          step("A", "parent", "mother"),
          step("B", "sibling", "uncle", { parents: [node("GF", "grandfather", 1), node("GM", "grandmother", 0)] }),
          step("C", "child", "first cousin"),
        ],
      },
      "Me",
    );
    expect(at(cards, "GF").y).toBeLessThan(at(cards, "A").y);
    expect(at(cards, "GF").x).toBe(at(cards, "A").x);
    expect(at(cards, "GM").x).toBe(at(cards, "B").x);
    expect(at(cards, "A").y).toBe(at(cards, "B").y);
    expect(at(cards, "C").x).toBe(at(cards, "B").x);
    expect(rings).toHaveLength(1);
    expectNoOverlap(cards);
  });

  it("draws a direct line as one column, and a spouse side by side", () => {
    const line = layoutRelationshipChart({ steps: [step("H", null), step("P", "parent", "father"), step("G", "parent", "grandfather")] }, "Me");
    expect(new Set(line.cards.map((c) => c.x)).size).toBe(1);
    expect(at(line.cards, "G").kind).toBe("end");
    expect(line.rings).toHaveLength(0);

    const spouse = layoutRelationshipChart({ steps: [step("H", null), step("W", "spouse", "wife")] }, "Me");
    expect(spouse.cards[0].y).toBe(spouse.cards[1].y);
    expect(spouse.rings).toHaveLength(1);
  });

  it("puts the first person beside their spouse, under her father", () => {
    const { cards, rings } = layoutRelationshipChart(
      { steps: [step("L", null), step("W", "spouse", "wife"), step("F", "parent", "father-in-law")] },
      "Home person",
    );
    expect(at(cards, "L").y).toBe(at(cards, "W").y);
    expect(at(cards, "L").x).toBeLessThan(at(cards, "W").x);
    expect(at(cards, "F").y).toBeLessThan(at(cards, "W").y);
    expect(at(cards, "F").x).toBe(at(cards, "W").x);
    expect(at(cards, "F").label).toBe("father-in-law");
    expect(rings).toHaveLength(1);
    expect(Math.min(...cards.map((c) => c.x))).toBe(8);
  });

  it("lays a chain through marriages out as family trees side by side", () => {
    // H's brother B ⚭ W, whose cousin is WC: H, B under their parents;
    // B ⚭ W; W up to her grandparent G and down to WC.
    const { cards, rings, lines } = layoutRelationshipChart(
      {
        steps: [
          step("H", null),
          step("B", "sibling", "brother", { parents: [node("P", "father", 1)] }),
          step("W", "spouse", "sister-in-law"),
          step("WP", "parent", ""),
          step("G", "parent", "", { partner: null }),
          step("U", "child", ""),
          step("WC", "child", ""),
        ],
      },
      "Me",
    );
    expect(at(cards, "W").y).toBe(at(cards, "B").y);
    expect(at(cards, "W").x).toBeGreaterThan(at(cards, "B").x);
    expect(at(cards, "WP").x).toBe(at(cards, "W").x);
    // G is centred over the turn, between W's column and WC's.
    expect(at(cards, "G").x).toBeGreaterThan(at(cards, "WP").x);
    expect(at(cards, "G").x).toBeLessThan(at(cards, "WC").x);
    expect(at(cards, "G").kind).toBe("top");
    expect(at(cards, "WC").y).toBe(at(cards, "W").y);
    expect(at(cards, "P").y).toBeLessThan(at(cards, "H").y);
    expect(rings).toHaveLength(1);
    expectNoOverlap(cards);
    // Every line stays inside the chart.
    const right = Math.max(...cards.map((c) => c.x)) + CARD_W;
    for (const line of lines) for (const [x] of line) expect(x).toBeLessThanOrEqual(right);
  });

  it("centres the shared child below a valley", () => {
    // A's child K, whose other parent (not A's spouse) is B.
    const { cards } = layoutRelationshipChart({ steps: [step("A", null), step("K", "child", "son"), step("B", "parent", "")] }, "Me");
    expect(at(cards, "K").y).toBeGreaterThan(at(cards, "A").y);
    expect(at(cards, "B").y).toBe(at(cards, "A").y);
    expect(at(cards, "K").x).toBeGreaterThan(at(cards, "A").x);
    expect(at(cards, "K").x).toBeLessThan(at(cards, "B").x);
    expectNoOverlap(cards);
  });

  it("gives everyone a column of their own when the tree shape would overlap", () => {
    // Down, up, then a sibling whose parents would land on X's row and
    // column: overlapping in the tree shape.
    const steps = [
      step("A", null),
      step("K", "child", "son"),
      step("X", "parent", ""),
      step("Y", "sibling", "", { parents: [node("Q", "", 1), node("R", "", 0)] }),
      step("Z", "parent", ""),
    ];
    const { cards } = layoutRelationshipChart({ steps }, "Me");
    expectNoOverlap(cards);
    // Just the chain, one column each, left to right.
    expect(cards.map((c) => c.node.handle)).toEqual(["A", "K", "X", "Y", "Z"]);
    expect(cards.map((c) => c.x)).toEqual([...cards.map((c) => c.x)].sort((a, b) => a - b));
  });

  it("keeps the line from the ancestor under them when shifted right", () => {
    // H ⚭ W; W's grandfather G on top, his son U's son X on the other leg.
    const { cards, lines } = layoutRelationshipChart(
      {
        steps: [
          step("H", null),
          step("W", "spouse", "wife"),
          step("P", "parent", "father-in-law"),
          step("G", "parent", "grandfather-in-law", { partner: null }),
          step("U", "child", "uncle-in-law"),
          step("X", "child", "cousin-in-law"),
        ],
      },
      "Home person",
    );
    const g = at(cards, "G");
    const fromG = lines.filter((l) => l[0][1] === g.y + CARD_H);
    expect(fromG).toHaveLength(2);
    for (const l of fromG) expect(l[0][0]).toBe(g.x + CARD_W / 2);
    expectNoOverlap(cards);
  });
});

describe("relationship_chart block", () => {
  it("shows names (in the tree's name format) and years from the person cache, and the default first label", async () => {
    renderWithProviders(
      <GrampletResultView
        status="done"
        response={{ type: "blocks", runId: "r", blocks: [{ type: "relationship-chart", paths: [COUSIN], startLabel: null }] }}
      />
    );
    expect(await screen.findByText("Home, Hal")).toBeTruthy();
    expect(screen.getByText("Cousin, Xena")).toBeTruthy();
    expect(screen.getByText("1971–")).toBeTruthy();
    expect(screen.getByText("Home person")).toBeTruthy();
    expect(screen.getByText("first cousin once removed")).toBeTruthy();
    // Not in the cache (a filtered People list) but on the server.
    expect(await screen.findByText("Grand, Gwen")).toBeTruthy();
    // Nowhere at all: a placeholder, not a blank card.
    expect(screen.getAllByText("(unknown)").length).toBeGreaterThan(0);
  });

  it("switches between several paths with a pager", async () => {
    const SPOUSE: RelationshipPath = { steps: [step("H", null), step("X", "spouse", "wife")] };
    renderWithProviders(
      <GrampletResultView
        status="done"
        response={{ type: "blocks", runId: "r3", blocks: [{ type: "relationship-chart", paths: [SPOUSE, COUSIN], startLabel: null }] }}
      />
    );
    expect(await screen.findByText("Cousin, Xena")).toBeTruthy();
    expect(screen.getAllByText("wife").length).toBeGreaterThan(0);
    expect(screen.queryByText("first cousin")).toBeNull();
    act(() => screen.getByRole("button", { name: "2" }).click());
    expect(await screen.findByText("first cousin")).toBeTruthy();
  });

  it("re-reads the cache when it changes, without the path changing", async () => {
    renderWithProviders(
      <GrampletResultView
        status="done"
        response={{ type: "blocks", runId: "r2", blocks: [{ type: "relationship-chart", paths: [COUSIN], startLabel: null }] }}
      />
    );
    expect(await screen.findByText("Home, Hal")).toBeTruthy();
    ROWS.A = [JSON.stringify({ first_name: "Ann", surname_list: [{ surname: "Mother" }] }), null, null];
    act(() => store.bump());
    expect(await screen.findByText("Mother, Ann")).toBeTruthy();
    delete ROWS.A;
  });
});
