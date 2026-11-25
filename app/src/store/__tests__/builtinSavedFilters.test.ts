// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTreeId: () => "tree-1",
}));

import { BUILTIN_SAVED_FILTERS } from "../../data/builtinSavedFilters";
import { gqlFilterPresets } from "../../data/gqlFilterPresets";
import { combineFilterTree } from "../goqlFilterTree";
import {
  builtinChangedSinceEdit, builtinHash, getHiddenBuiltinIds, setBuiltinHidden, showAllBuiltins,
  withBuiltinSavedFilters,
} from "../builtinSavedFilters";
import type { SavedFilter } from "../savedFilterMedia";

const research = BUILTIN_SAVED_FILTERS.find((f) => f.id === "builtin-research-gaps")!;

describe("built-in saved filters", () => {
  it("each has a unique id and compiles from built-in rules of its own kind", () => {
    const ids = BUILTIN_SAVED_FILTERS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of BUILTIN_SAVED_FILTERS) {
      expect(f.id).toMatch(/^builtin-[a-z0-9-]+$/);
      expect(f.tree.namespace).toBe(f.namespace);
      const { whereExpr } = combineFilterTree(f.tree, gqlFilterPresets);
      expect(whereExpr.length).toBeGreaterThan(0);
    }
  });

  it("lists built-ins before the tree's own filters", () => {
    const own: SavedFilter = { id: "x", name: "Mine", namespace: "Person", tree: research.tree, handle: "h1" };
    const all = withBuiltinSavedFilters([own]);
    expect(all.filter((f) => f.origin === "builtin")).toHaveLength(BUILTIN_SAVED_FILTERS.length);
    expect(all[all.length - 1]).toEqual(own);
  });

  it("a tree filter with a built-in's id replaces it", () => {
    const edited: SavedFilter = {
      id: research.id, name: "Research gaps", namespace: "Person", tree: research.tree, handle: "h2",
      builtinHash: builtinHash(research),
    };
    const all = withBuiltinSavedFilters([edited]);
    const matches = all.filter((f) => f.id === research.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ handle: "h2", origin: "edited-builtin" });
    expect(builtinChangedSinceEdit(matches[0])).toBe(false);
  });

  it("notices when the built-in changed after the edit", () => {
    const edited: SavedFilter = {
      id: research.id, name: "Research gaps", namespace: "Person", tree: research.tree, handle: "h2",
      builtinHash: "00000000",
    };
    const [match] = withBuiltinSavedFilters([edited]).filter((f) => f.id === research.id);
    expect(builtinChangedSinceEdit(match)).toBe(true);
  });

  describe("hiding", () => {
    beforeEach(() => localStorage.clear());

    it("is remembered per tree, and can be undone", () => {
      setBuiltinHidden(research.id, true);
      expect(getHiddenBuiltinIds().has(research.id)).toBe(true);
      setBuiltinHidden(research.id, false);
      expect(getHiddenBuiltinIds().size).toBe(0);
      setBuiltinHidden(research.id, true);
      showAllBuiltins();
      expect(getHiddenBuiltinIds().size).toBe(0);
    });

    it("still resolves a hidden built-in, for rules that refer to it", () => {
      setBuiltinHidden(research.id, true);
      expect(withBuiltinSavedFilters([]).some((f) => f.id === research.id)).toBe(true);
    });
  });
});
