// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import { closeRelationshipWindow, openRelationshipWindow } from "../../../store/relationshipWindow";

vi.mock("../RelationshipBetween", () => ({
  RelationshipBetween: ({ from, to, chart }: { from: string; to: string; chart: string }) => (
    <div data-testid="between">{`${from}->${to} ${chart}`}</div>
  ),
}));
vi.mock("../../../pyodidePoc/RelationshipChart", () => ({
  usePeople: () =>
    new Map([
      ["H", { name: "Home, Hal", birth: null, death: null }],
      ["X", { name: "Cousin, Xena", birth: null, death: null }],
    ]),
}));

import { RelationshipWindow } from "../RelationshipWindow";

afterEach(() => act(() => closeRelationshipWindow()));

describe("RelationshipWindow", () => {
  it("shows nothing until opened, then the pair's names and chart", () => {
    renderWithProviders(<RelationshipWindow />);
    expect(screen.queryByTestId("between")).toBeNull();
    act(() => openRelationshipWindow("H", "X"));
    expect(screen.getByText("Relationship: Home, Hal → Cousin, Xena")).toBeTruthy();
    expect(screen.getByTestId("between").textContent).toBe("H->X always");
    act(() => closeRelationshipWindow());
    expect(screen.queryByTestId("between")).toBeNull();
  });
});
