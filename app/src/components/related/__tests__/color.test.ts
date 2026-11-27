import { describe, expect, it } from "vitest";
import { gtkColorToCss, readableTextOn } from "../color";

describe("readableTextOn", () => {
  it("picks black on light tag colors and white on dark ones", () => {
    expect(readableTextOn("#ffff00")).toBe("#0b0b0b");
    expect(readableTextOn("#a5d8ff")).toBe("#0b0b0b");
    expect(readableTextOn(gtkColorToCss("#fffffffe0000"))).toBe("#0b0b0b");
    expect(readableTextOn("#1c3d6e")).toBe("#ffffff");
    expect(readableTextOn(gtkColorToCss("#8b8b00000000"))).toBe("#ffffff");
  });
  it("leaves non-hex colors to the default", () => {
    expect(readableTextOn(undefined)).toBeUndefined();
    expect(readableTextOn("gray")).toBeUndefined();
  });
});
