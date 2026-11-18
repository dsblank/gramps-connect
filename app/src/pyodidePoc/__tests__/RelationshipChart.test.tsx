// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import type { ChartPath } from "../../store/relationshipPath";
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

const node = (handle: string, relationship_string = "", gender = 2) => ({ handle, relationship_string, gender });
/** Someone Gramps has no name for, named from the person before them. */
const linked = (handle: string, link_label: string, link_from: string, gender = 2) => ({ ...node(handle, "", gender), link_label, link_from });

/** Second cousins once removed would be longer; first cousins once
 * removed through a grandparent couple keeps the test readable:
 * H -> A -> GM (⚭ GF) -> B -> C -> X. */
const COUSIN: ChartPath = {
  people: [node("H"), node("A", "mother"), node("GM", "grandmother"), node("B", "uncle"), node("C", "first cousin"), node("X", "first cousin once removed")],
  common_ancestors: ["GM", "GF"],
  partner: node("GF", "grandfather", 1),
  via: [],
};

describe("layoutRelationshipChart", () => {
  it("puts the couple on top and one leg per side, one row per generation", () => {
    const { cards, rings } = layoutRelationshipChart(COUSIN, "Home person");
    const at = (h: string) => cards.find((c) => c.node.handle === h)!;
    expect(at("GM").y).toBe(at("GF").y);
    expect(at("GM").x).toBeLessThan(at("GF").x);
    // The left leg (to H) is a row shorter than the right one (to X).
    expect(at("A").y).toBe(at("B").y);
    expect(at("H").y).toBe(at("C").y);
    expect(at("X").y).toBeGreaterThan(at("H").y);
    expect(at("H").x).toBeLessThan(at("X").x);
    expect(rings).toHaveLength(1);
    expect(at("H").label).toBe("Home person");
    expect([at("H").kind, at("X").kind, at("GM").kind, at("A").kind]).toEqual(["end", "end", "top", "mid"]);
  });

  it("draws a direct line as one column, and a spouse side by side", () => {
    const line = layoutRelationshipChart(
      { people: [node("H"), node("P", "father"), node("G", "grandfather")], common_ancestors: ["G"], partner: null, via: [] },
      "Me"
    );
    expect(new Set(line.cards.map((c) => c.x)).size).toBe(1);
    expect(line.cards.find((c) => c.node.handle === "G")!.kind).toBe("end");

    const spouse = layoutRelationshipChart({ people: [node("H"), node("W", "wife")], common_ancestors: [], partner: null, via: [] }, "Me");
    expect(spouse.cards[0].y).toBe(spouse.cards[1].y);
    expect(spouse.rings).toHaveLength(1);
  });
});

describe("in-law layout", () => {
  it("puts the first person beside their spouse, with the server's in-law labels", () => {
    // Lewis ⚭ Luella, whose father is Henry: Henry on top, Luella below
    // him, Lewis beside Luella.
    const { cards, rings } = layoutRelationshipChart(
      {
        people: [node("L", "", 1), node("W", "wife", 0), node("F", "father-in-law", 1)],
        common_ancestors: ["F"],
        partner: null,
        via: [{ handle: "W", married_to: "L" }],
      },
      "Home person"
    );
    const at = (h: string) => cards.find((c) => c.node.handle === h)!;
    expect(at("L").y).toBe(at("W").y);
    expect(at("L").x).toBeLessThan(at("W").x);
    expect(at("F").y).toBeLessThan(at("W").y);
    expect(at("F").label).toBe("father-in-law");
    expect(at("W").label).toBe("wife");
    expect([at("L").kind, at("W").kind, at("F").kind]).toEqual(["end", "mid", "end"]);
    expect(rings).toHaveLength(1);
    expect(Math.min(...cards.map((c) => c.x))).toBe(8);
  });

  it("puts the last person beside their spouse on the right", () => {
    const { cards } = layoutRelationshipChart(
      {
        people: [node("H"), node("P", "father"), node("B", "brother"), linked("BW", "wife", "B")],
        common_ancestors: ["P"],
        partner: null,
        via: [{ handle: "B", married_to: "BW" }],
      },
      "Home person"
    );
    const at = (h: string) => cards.find((c) => c.node.handle === h)!;
    expect(at("BW").y).toBe(at("B").y);
    expect(at("BW").x).toBeGreaterThan(at("B").x);
    expect(at("BW").label).toBe("brother's wife");
  });
});

describe("in-law with two legs", () => {
  it("keeps every line between cards when shifted right for the first person's spouse", () => {
    // H ⚭ W; W's grandfather G is on top, his son U's son X on the other leg.
    const { cards, lines } = layoutRelationshipChart(
      {
        people: [node("H", "", 1), node("W", "wife", 0), node("P", "father-in-law", 1), node("G", "grandfather-in-law", 1), node("U", "uncle-in-law", 1), node("X", "cousin-in-law", 1)],
        common_ancestors: ["G"],
        partner: null,
        via: [{ handle: "W", married_to: "H" }],
      },
      "Home person"
    );
    const right = Math.max(...cards.map((c) => c.x)) + 188;
    for (const line of lines) for (const [x] of line) expect(x).toBeLessThanOrEqual(right);
    // The line down from G starts under G's centre.
    const g = cards.find((c) => c.node.handle === "G")!;
    const fromG = lines.filter((l) => l[0][1] === g.y + 76);
    expect(fromG.length).toBe(2);
    for (const l of fromG) expect(l[0][0]).toBe(g.x + 188 / 2);
  });
});

describe("two-marriage layout", () => {
  it("puts each married-in end beside their spouse, and names the unnamed from the person before", () => {
    // Lewis ⚭ W, whose brother B ⚭ X: W and B under their father P,
    // Lewis left of W, X right of B.
    const { cards, rings } = layoutRelationshipChart(
      {
        people: [node("L", "", 1), node("W", "wife", 0), node("P", "father-in-law", 1), node("B", "brother-in-law", 1), linked("X", "wife", "B", 0)],
        common_ancestors: ["P"],
        partner: null,
        via: [
          { handle: "W", married_to: "L" },
          { handle: "B", married_to: "X" },
        ],
      },
      "Home person"
    );
    const at = (h: string) => cards.find((c) => c.node.handle === h)!;
    expect(at("L").y).toBe(at("W").y);
    expect(at("X").y).toBe(at("B").y);
    expect(at("L").x).toBeLessThan(at("W").x);
    expect(at("W").x).toBeLessThan(at("B").x);
    expect(at("B").x).toBeLessThan(at("X").x);
    expect([at("P").label, at("B").label, at("X").label]).toEqual(["father-in-law", "brother-in-law", "brother-in-law's wife"]);
    expect(rings).toHaveLength(2);
  });
});

describe("a path that isn't one family tree", () => {
  it("is one row of cards, with a ring at each marriage only", () => {
    // A's brother B ⚭ W, whose brother is WB: a marriage in the middle.
    const steps = [
      { ...node("A"), link: null },
      { ...node("B", "brother", 1), link: "sibling" as const },
      { ...node("W", "sister-in-law", 0), link: "spouse" as const },
      { ...linked("WB", "brother", "W", 1), link: "sibling" as const },
    ];
    const { cards, rings, lines } = layoutRelationshipChart(
      { steps, people: steps.map(({ link: _, ...n }) => n), common_ancestors: [], partner: null, via: [] },
      "Home person"
    );
    expect(new Set(cards.map((c) => c.y)).size).toBe(1);
    expect(cards.map((c) => c.node.handle)).toEqual(["A", "B", "W", "WB"]);
    expect(lines).toHaveLength(3);
    expect(rings).toHaveLength(1);
    expect(cards[3].label).toBe("sister-in-law's brother");
  });
});

describe("relationship_chart block", () => {
  it("shows names (in the tree's name format) and years from the person cache, and the default first label", async () => {
    renderWithProviders(
      <GrampletResultView
        status="done"
        response={{ type: "blocks", runId: "r", blocks: [{ type: "relationship-chart", path: COUSIN, startLabel: null }] }}
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

  it("re-reads the cache when it changes, without the path changing", async () => {
    renderWithProviders(
      <GrampletResultView
        status="done"
        response={{ type: "blocks", runId: "r2", blocks: [{ type: "relationship-chart", path: COUSIN, startLabel: null }] }}
      />
    );
    expect(await screen.findByText("Home, Hal")).toBeTruthy();
    ROWS.A = [JSON.stringify({ first_name: "Ann", surname_list: [{ surname: "Mother" }] }), null, null];
    act(() => store.bump());
    expect(await screen.findByText("Mother, Ann")).toBeTruthy();
    delete ROWS.A;
  });
});
