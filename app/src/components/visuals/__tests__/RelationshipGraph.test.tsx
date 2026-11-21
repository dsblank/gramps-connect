// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, renderHook } from "../../../testUtils/renderWithProviders";

vi.mock("../../related/RelationshipBetween", () => ({
  RelationshipBetween: ({ from, to, chart }: { from: string; to: string; chart: string }) => (
    <div data-testid="between">{`${from}->${to} ${chart}`}</div>
  ),
}));
vi.mock("../../RecordPicker", () => ({
  RecordPicker: ({ onPick }: { onPick: (item: { handle: string }) => void }) => <button onClick={() => onPick({ handle: "P" })}>pick</button>,
}));
const home = vi.hoisted(() => ({ handle: "H" as string | null }));
vi.mock("../../../store/homePersonPreference", () => ({ getHomePersonHandle: () => home.handle }));

import { RelationshipGraph, useRelationshipOther } from "../RelationshipGraph";

describe("RelationshipGraph", () => {
  it("starts comparing with the Home person", () => {
    home.handle = "H";
    expect(renderHook(() => useRelationshipOther()).result.current[0]).toBe("H");
  });

  it("charts the root described from the other person, chart always open", () => {
    renderWithProviders(<RelationshipGraph rootHandle="R" other="H" onPickOther={() => {}} />);
    expect(screen.getByTestId("between").textContent).toBe("H->R always");
  });

  it("asks for someone to compare with when there's no Home person, or it's the root", () => {
    const picked: string[] = [];
    const { unmount } = renderWithProviders(<RelationshipGraph rootHandle="R" other={null} onPickOther={(h) => picked.push(h)} />);
    expect(screen.getByText("No Home person is set. Pick someone to see how they're related.")).toBeTruthy();
    screen.getByText("pick").click();
    expect(picked).toEqual(["P"]);
    unmount();
    renderWithProviders(<RelationshipGraph rootHandle="R" other="R" onPickOther={() => {}} />);
    expect(screen.getByText("The chart is already on this person. Pick someone else to compare with.")).toBeTruthy();
    expect(screen.queryByTestId("between")).toBeNull();
  });
});
