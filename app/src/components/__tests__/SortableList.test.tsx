// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import { SortableList, sortableIds } from "../SortableList";

function list(keys: string[], disabled = false, onMove = vi.fn()) {
  renderWithProviders(
    <SortableList
      keys={keys}
      onMove={onMove}
      disabled={disabled}
      renderItem={(i, grip) => <div>{grip}<span>{keys[i]}</span></div>}
    />
  );
  return onMove;
}

describe("SortableList", () => {
  it("shows a grip per row only when there is something to reorder", () => {
    list(["a", "b"]);
    expect(screen.getAllByLabelText("Drag to reorder")).toHaveLength(2);
    expect(screen.getByText("b")).toBeTruthy();
  });

  it("has no grips for one row or when disabled", () => {
    list(["a"]);
    expect(screen.queryAllByLabelText("Drag to reorder")).toHaveLength(0);
    list(["x", "y"], true);
    expect(screen.queryAllByLabelText("Drag to reorder")).toHaveLength(0);
    expect(screen.getByText("y")).toBeTruthy();
  });
});

describe("sortableIds", () => {
  it("is unique even when a handle repeats, and stable per occurrence", () => {
    expect(sortableIds(["a", "b", "a", "a"])).toEqual(["a#0", "b#0", "a#1", "a#2"]);
    expect(sortableIds(["b", "a"])).toEqual(["b#0", "a#0"]);
  });
});
