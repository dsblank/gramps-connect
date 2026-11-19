// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

let tree: string | null = "tree-a";
vi.mock("../../auth/auth", () => ({ getTreeId: () => tree }));

const { loadViewport, saveViewport } = await import("../mapViewport");
const { STORAGE_KEYS } = await import("../storageKeys");

describe("map viewport per tree", () => {
  beforeEach(() => {
    localStorage.clear();
    tree = "tree-a";
  });

  it("remembers each tree's own spot", () => {
    saveViewport({ lat: 1, lng: 2, zoom: 3 });
    tree = "tree-b";
    expect(loadViewport()).toBeNull();
    saveViewport({ lat: 50, lng: 4, zoom: 6 });
    tree = "tree-a";
    expect(loadViewport()).toEqual({ lat: 1, lng: 2, zoom: 3 });
    tree = "tree-b";
    expect(loadViewport()).toEqual({ lat: 50, lng: 4, zoom: 6 });
  });

  it("takes a viewport saved before it was per tree as this tree's", () => {
    localStorage.setItem(STORAGE_KEYS.mapViewport, JSON.stringify({ lat: 10, lng: 20, zoom: 5 }));
    expect(loadViewport()).toEqual({ lat: 10, lng: 20, zoom: 5 });
    tree = "tree-b";
    saveViewport({ lat: 0, lng: 0, zoom: 1 });
    tree = "tree-a";
    expect(loadViewport()).toEqual({ lat: 10, lng: 20, zoom: 5 });
  });

  it("ignores junk", () => {
    localStorage.setItem(STORAGE_KEYS.mapViewport, "5");
    expect(loadViewport()).toBeNull();
    localStorage.setItem(STORAGE_KEYS.mapViewport, "{not json");
    expect(loadViewport()).toBeNull();
  });
});
