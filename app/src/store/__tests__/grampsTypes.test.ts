import { describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getTreeId: vi.fn().mockReturnValue(null),
  getCurrentUsername: vi.fn().mockReturnValue(null),
}));

import { canonicalTypeName } from "../grampsTypes";

const options = { builtIn: ["Country", "County", "City", "Unknown"], custom: ["Cemetery", "Township"] };

describe("canonicalTypeName", () => {
  it("snaps a case or spacing variant to the existing spelling", () => {
    expect(canonicalTypeName("county", options)).toBe("County");
    expect(canonicalTypeName(" CITY ", options)).toBe("City");
    expect(canonicalTypeName("cemetery", options)).toBe("Cemetery");
  });

  it("leaves a genuinely new custom type, and blank, alone", () => {
    expect(canonicalTypeName("Plantation", options)).toBe("Plantation");
    expect(canonicalTypeName("Count", options)).toBe("Count");
    expect(canonicalTypeName("", options)).toBe("");
  });
});
