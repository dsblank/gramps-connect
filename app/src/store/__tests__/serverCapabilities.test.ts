import { describe, expect, it } from "vitest";
import {
  grampsVersionAtLeast, supportsBackgroundDelete, supportsLunarCalendars, supportsOrderByStrings, versionAfter,
} from "../serverCapabilities";

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

describe("supportsBackgroundDelete", () => {
  it("needs gramps-web-api 3.25.0 or later", () => {
    expect(supportsBackgroundDelete("3.25.0")).toBe(true);
    expect(supportsBackgroundDelete("3.26.1")).toBe(true);
    expect(supportsBackgroundDelete("4.0.0")).toBe(true);
    expect(supportsBackgroundDelete("3.24.0")).toBe(false);
    expect(supportsBackgroundDelete("2.99.0")).toBe(false);
    expect(supportsBackgroundDelete("")).toBe(false);
  });
});

describe("supportsOrderByStrings", () => {
  it("is false on 3.25.2 and older, true on anything newer", () => {
    for (const v of ["3.25.2", "3.25.1", "3.24.0", "2.9.9", "3.25"]) expect(supportsOrderByStrings(v)).toBe(false);
    for (const v of ["3.25.3", "3.26.0", "3.26.0rc1", "4.0.0", "3.26"]) expect(supportsOrderByStrings(v)).toBe(true);
  });

  it("treats an unreadable version as old", () => {
    expect(supportsOrderByStrings("")).toBe(false);
    expect(supportsOrderByStrings("dev")).toBe(false);
  });
});

describe("versionAfter", () => {
  it("compares major, minor and patch in turn", () => {
    expect(versionAfter("3.25.10", [3, 25, 2])).toBe(true);
    expect(versionAfter("3.3.0", [3, 25, 2])).toBe(false);
    expect(versionAfter(" 3.26.0 ", [3, 25, 2])).toBe(true);
  });
});
