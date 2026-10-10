import { describe, expect, it } from "vitest";
import { grampletKind, validateGrampletKindFields } from "../grampletManifest";

describe("grampletKind", () => {
  it("treats a manifest with no kind as a View Gramplet", () => {
    expect(grampletKind({})).toBe("view");
  });

  it("returns a declared kind", () => {
    expect(grampletKind({ kind: "window" })).toBe("window");
  });
});

describe("validateGrampletKindFields", () => {
  it("accepts a manifest without either field (every existing Gramplet)", () => {
    expect(validateGrampletKindFields({ id: "g", label: "G", code: "" })).toBeNull();
  });

  it("checks kind", () => {
    expect(validateGrampletKindFields({ kind: "view" })).toBeNull();
    expect(validateGrampletKindFields({ kind: "window" })).toBeNull();
    expect(validateGrampletKindFields({ kind: "panel" })).toMatch(/"kind"/);
  });

  it("checks category", () => {
    expect(validateGrampletKindFields({ category: "chart" })).toBeNull();
    expect(validateGrampletKindFields({ category: 3 })).toMatch(/"category"/);
  });
});
