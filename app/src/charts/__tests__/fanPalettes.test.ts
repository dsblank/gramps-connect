import { describe, expect, it } from "vitest";
import { FAN_PALETTES, findPalette, generationColor, palettesFor } from "../fanPalettes";
import { gradientColor, threeStopGradient } from "../personColors";

describe("fanPalettes", () => {
  it("offers every palette for Generation and only gradients for Age at death", () => {
    expect(palettesFor("gen")).toHaveLength(FAN_PALETTES.length);
    expect(palettesFor("death").every((p) => p.kind === "gradient")).toBe(true);
    expect(palettesFor("death").length).toBeGreaterThan(0);
  });

  it("treats an unknown id, or a distinct palette for Age at death, as Original", () => {
    expect(findPalette("original", "gen")).toBeNull();
    expect(findPalette("no-such-palette", "gen")).toBeNull();
    expect(findPalette("set3", "death")).toBeNull();
    expect(findPalette("set3", "gen")?.id).toBe("set3");
    expect(findPalette("viridis", "death")?.id).toBe("viridis");
  });

  it("repeats a distinct palette past its last color", () => {
    const set2 = findPalette("set2", "gen")!;
    expect(generationColor(set2, 0, 20)).toBe(set2.colors[0]);
    expect(generationColor(set2, set2.colors.length, 20)).toBe(set2.colors[0]);
    expect(generationColor(set2, set2.colors.length + 2, 20)).toBe(set2.colors[2]);
  });

  it("runs a gradient palette from the center to the outermost ring drawn", () => {
    const blues = findPalette("blues", "gen")!;
    expect(generationColor(blues, 0, 6)).toBe(blues.colors[0]);
    expect(generationColor(blues, 6, 6)).toBe(blues.colors[blues.colors.length - 1]);
    expect(generationColor(blues, 0, 0)).toBe(blues.colors[0]);
  });

  it("uses only valid 6-digit hex colors", () => {
    for (const p of FAN_PALETTES) for (const c of p.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("gradientColor", () => {
  it("hits each stop exactly and blends between them", () => {
    expect(gradientColor(["#000000", "#ffffff"], 0)).toBe("#000000");
    expect(gradientColor(["#000000", "#ffffff"], 1)).toBe("#ffffff");
    expect(gradientColor(["#000000", "#ffffff"], 0.5)).toBe("#808080");
    expect(gradientColor(["#000000", "#ff0000", "#ffffff"], 0.5)).toBe("#ff0000");
    expect(gradientColor(["#123456"], 0.7)).toBe("#123456");
  });

  it("matches the old three-stop walk", () => {
    const stops = ["#eaf1ec", "#5f97c9", "#232449"] as const;
    for (const f of [0, 0.1, 0.25, 0.5, 0.6, 0.9, 1, -1, 2]) {
      expect(threeStopGradient(stops, f)).toBe(gradientColor(stops, f));
    }
    expect(threeStopGradient(stops, 0.5)).toBe("#5f97c9");
  });
});
