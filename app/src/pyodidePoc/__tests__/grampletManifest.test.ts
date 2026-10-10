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

  it("checks allowChanges, which only a (window) Gramplet may have", () => {
    expect(validateGrampletKindFields({ kind: "window", allowChanges: true })).toBeNull();
    expect(validateGrampletKindFields({ kind: "window", allowChanges: false })).toBeNull();
    expect(validateGrampletKindFields({ allowChanges: false })).toBeNull();
    expect(validateGrampletKindFields({ kind: "window", allowChanges: "yes" })).toMatch(/"allowChanges"/);
    expect(validateGrampletKindFields({ allowChanges: true })).toMatch(/"kind": "window"/);
    expect(validateGrampletKindFields({ kind: "view", allowChanges: true })).toMatch(/"kind": "window"/);
  });
});
