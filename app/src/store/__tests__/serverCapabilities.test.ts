import { describe, expect, it } from "vitest";
import { grampsVersionAtLeast, supportsLunarCalendars } from "../serverCapabilities";

describe("serverCapabilities", () => {
  it("compares Gramps versions by major and minor", () => {
    expect(grampsVersionAtLeast("6.2.0", [6, 2])).toBe(true);
    expect(grampsVersionAtLeast("6.2.0-beta1", [6, 2])).toBe(true);
    expect(grampsVersionAtLeast("6.10.1", [6, 2])).toBe(true);
    expect(grampsVersionAtLeast("7.0.0", [6, 2])).toBe(true);
    expect(grampsVersionAtLeast("6.1.9", [6, 2])).toBe(false);
    expect(grampsVersionAtLeast("5.2.4", [6, 2])).toBe(false);
    expect(grampsVersionAtLeast("", [6, 2])).toBe(false);
    expect(grampsVersionAtLeast("unknown", [6, 2])).toBe(false);
  });

  it("offers the lunar calendars from Gramps 6.2", () => {
    expect(supportsLunarCalendars("6.0.8")).toBe(false);
    expect(supportsLunarCalendars("6.2.0")).toBe(true);
  });
});
