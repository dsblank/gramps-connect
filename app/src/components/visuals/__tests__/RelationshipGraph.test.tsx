// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderWithProviders, screen, renderHook } from "../../../testUtils/renderWithProviders";

vi.mock("../../related/RelationshipBetween", () => ({
  RelationshipBetween: ({ from, to, chart, menu }: {
    from: string; to: string; chart: string;
    menu?: { hideVisuals?: string[]; actions?: (h: string) => { label: string; onClick: () => void }[] };
  }) => (
    <div>
      <div data-testid="between">{`${from}->${to} ${chart} hide:${menu?.hideVisuals?.join(",")}`}</div>
      {["H", "X"].map((h) => (
        <div key={h} data-testid={`menu-${h}`}>
          {menu?.actions?.(h).map((a) => <button key={a.label} onClick={a.onClick}>{`${h}: ${a.label}`}</button>)}
        </div>
      ))}
    </div>
  ),
}));
vi.mock("../../../pyodidePoc/RelationshipChart", () => ({
  usePeople: (handles: string[]) => new Map(handles.map((h) => [h, { name: `Name ${h}`, birth: null, death: null }])),
}));
const home = vi.hoisted(() => ({ handle: "H" as string | null }));
vi.mock("../../../store/homePersonPreference", () => ({ getHomePersonHandle: () => home.handle }));

import { RelationshipGraph, useRelationshipPair, type RelationshipPair } from "../RelationshipGraph";

const pair = (first: string | null, second: string | null): RelationshipPair => ({
  first, second, setFirst: () => {}, setSecond: () => {}, swap: () => {},
});

describe("useRelationshipPair", () => {
  it("starts on the Home person and the root", () => {
    home.handle = "H";
    const { result } = renderHook(() => useRelationshipPair("R"));
    expect([result.current.first, result.current.second]).toEqual(["H", "R"]);
  });

  it("keeps a picked second person until the root changes, and keeps the first", () => {
    home.handle = "H";
    const { result, rerender } = renderHook(({ root }) => useRelationshipPair(root), { initialProps: { root: "R" } });
    act(() => result.current.setFirst("A"));
    act(() => result.current.setSecond("B"));
    expect([result.current.first, result.current.second]).toEqual(["A", "B"]);
    rerender({ root: "R2" });
    expect([result.current.first, result.current.second]).toEqual(["A", "R2"]);
  });

  it("swaps the two", () => {
    home.handle = "H";
    const { result } = renderHook(() => useRelationshipPair("R"));
    act(() => result.current.swap());
    expect([result.current.first, result.current.second]).toEqual(["R", "H"]);
  });
});

describe("RelationshipGraph", () => {
  it("shows both people and describes the second from the first", () => {
    renderWithProviders(<RelationshipGraph pair={pair("H", "R")} />);
    expect(screen.getByText("Name H")).toBeTruthy();
    expect(screen.getByText("Name R")).toBeTruthy();
    expect(screen.getByTestId("between").textContent).toBe("H->R always hide:tree");
  });

  it("offers each person in the chart as the first or second person, but not where they already are", () => {
    const picked: string[] = [];
    renderWithProviders(
      <RelationshipGraph pair={{ ...pair("H", "R"), setFirst: (h) => picked.push(`first ${h}`), setSecond: (h) => picked.push(`second ${h}`) }} />,
    );
    expect(screen.getByTestId("menu-H").textContent).toBe("H: Use as second person");
    screen.getByText("X: Use as first person").click();
    screen.getByText("X: Use as second person").click();
    expect(picked).toEqual(["first X", "second X"]);
  });

  it("asks for a person when a box is empty or both are the same", () => {
    const { unmount } = renderWithProviders(<RelationshipGraph pair={pair(null, "R")} />);
    expect(screen.getByText("No Home person is set. Pick a person in the first box.")).toBeTruthy();
    unmount();
    renderWithProviders(<RelationshipGraph pair={pair("R", "R")} />);
    expect(screen.getByText("Both boxes hold the same person. Pick someone else in one of them.")).toBeTruthy();
    expect(screen.queryByTestId("between")).toBeNull();
  });
});
