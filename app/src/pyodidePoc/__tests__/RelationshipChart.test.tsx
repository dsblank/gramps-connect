// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import type { RelationshipPath } from "../../store/relationshipPath";
import { GrampletResultView } from "../GrampletResultView";
import { layoutRelationshipChart } from "../RelationshipChart";

// The local person cache, as readRowByHandle returns it: primary_name and
// the two dates as JSON text.
const ROWS: Record<string, unknown[]> = {
  H: [JSON.stringify({ first_name: "Hal", surname_list: [{ surname: "Home" }] }), JSON.stringify({ dateval: [0, 0, 1971, false], modifier: 0 }), null],
  X: [JSON.stringify({ first_name: "Xena", surname_list: [{ surname: "Cousin" }] }), null, null],
};
vi.mock("../../store/registry", () => ({
  getViewStore: () => ({
    ensureLoaded: async () => {},
    readRowByHandle: (handle: string) => ROWS[handle] ?? null,
  }),
}));

const node = (handle: string, relationship_string = "", gender = 2) => ({ handle, relationship_string, gender });

/** Second cousins once removed would be longer; first cousins once
 * removed through a grandparent couple keeps the test readable:
 * H -> A -> GM (⚭ GF) -> B -> C -> X. */
const COUSIN: RelationshipPath = {
  people: [node("H"), node("A", "mother"), node("GM", "grandmother"), node("B", "uncle"), node("C", "first cousin"), node("X", "first cousin once removed")],
  common_ancestors: ["GM", "GF"],
  partner: node("GF", "grandfather", 1),
  via: null,
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
      { people: [node("H"), node("P", "father"), node("G", "grandfather")], common_ancestors: ["G"], partner: null, via: null },
      "Me"
    );
    expect(new Set(line.cards.map((c) => c.x)).size).toBe(1);
    expect(line.cards.find((c) => c.node.handle === "G")!.kind).toBe("end");

    const spouse = layoutRelationshipChart({ people: [node("H"), node("W", "wife")], common_ancestors: [], partner: null, via: null }, "Me");
    expect(spouse.cards[0].y).toBe(spouse.cards[1].y);
    expect(spouse.rings).toHaveLength(1);
  });
});

describe("in-law layout", () => {
  it("puts the first person beside their spouse, and labels the rest through her", () => {
    // Lewis ⚭ Luella, whose father is Henry: Henry on top, Luella below
    // him, Lewis beside Luella.
    const { cards, rings } = layoutRelationshipChart(
      {
        people: [node("L", "", 1), node("W", "wife", 0), node("F", "father", 1)],
        common_ancestors: ["F"],
        partner: null,
        via: { handle: "W", married_to: "L" },
      },
      "Home person"
    );
    const at = (h: string) => cards.find((c) => c.node.handle === h)!;
    expect(at("L").y).toBe(at("W").y);
    expect(at("L").x).toBeLessThan(at("W").x);
    expect(at("F").y).toBeLessThan(at("W").y);
    expect(at("F").label).toBe("wife's father");
    expect(at("W").label).toBe("wife");
    expect([at("L").kind, at("W").kind, at("F").kind]).toEqual(["end", "mid", "end"]);
    expect(rings).toHaveLength(1);
    expect(Math.min(...cards.map((c) => c.x))).toBe(8);
  });

  it("puts the last person beside their spouse on the right", () => {
    const { cards } = layoutRelationshipChart(
      {
        people: [node("H"), node("P", "father"), node("B", "brother"), node("BW", "wife")],
        common_ancestors: ["P"],
        partner: null,
        via: { handle: "B", married_to: "BW" },
      },
      "Home person"
    );
    const at = (h: string) => cards.find((c) => c.node.handle === h)!;
    expect(at("BW").y).toBe(at("B").y);
    expect(at("BW").x).toBeGreaterThan(at("B").x);
    expect(at("BW").label).toBe("brother's wife");
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
    // Not in the cache (yet): a placeholder, not a blank card.
    expect(screen.getAllByText("(unknown)").length).toBeGreaterThan(0);
  });
});
