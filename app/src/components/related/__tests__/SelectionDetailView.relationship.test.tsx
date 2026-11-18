// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import type { ViewConfig } from "../../../store/views";

vi.mock("../../RelatedPanel", () => ({
  RelatedPanel: ({ handle, actions, belowActions }: { handle: string; actions: boolean; belowActions?: ReactNode }) => (
    <div>
      {actions && <button>{`edit ${handle}`}</button>}
      {belowActions}
      <div>{`panel ${handle}`}</div>
    </div>
  ),
}));
vi.mock("../AddButton", () => ({ AddButton: () => null }));
vi.mock("../MergeButton", () => ({ MergeButton: () => <button>merge</button> }));
vi.mock("../BulkDeleteButton", () => ({ BulkDeleteButton: () => null }));
vi.mock("../BulkTagButton", () => ({ BulkTagButton: () => null }));
vi.mock("../RelationshipBetween", () => ({
  RelationshipBetween: ({ from, to, delayMs }: { from: string; to: string; delayMs?: number }) => (
    <div data-testid="between">{`${from}->${to} wait ${delayMs ?? 0}`}</div>
  ),
}));
const home = vi.hoisted(() => ({ handle: "H" as string | null }));
vi.mock("../../../store/homePersonPreference", () => ({ getHomePersonHandle: () => home.handle }));

import { SelectionDetailView } from "../SelectionDetailView";

const PEOPLE = { key: "person" } as ViewConfig;
const FAMILIES = { key: "family" } as ViewConfig;
const render = (view: ViewConfig, handles: [string] | [string, string]) =>
  renderWithProviders(<SelectionDetailView view={view} handles={handles} revision={0} onNavigate={() => {}} />);

describe("SelectionDetailView's relationship sentence", () => {
  it("relates one selected person to the Home person, after a short wait", () => {
    home.handle = "H";
    render(PEOPLE, ["X"]);
    expect(screen.getByTestId("between").textContent).toBe("H->X wait 300");
  });

  it("relates the second of two selected to the first, at once", () => {
    home.handle = "H";
    render(PEOPLE, ["A", "B"]);
    expect(screen.getByTestId("between").textContent).toBe("A->B wait 0");
  });

  it("puts the sentence just below the buttons, the panel's own for one, the shared row for two", () => {
    home.handle = "H";
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const one = render(PEOPLE, ["A"]);
    expect(follows(screen.getByText("edit A"), screen.getByTestId("between"))).toBe(true);
    expect(follows(screen.getByTestId("between"), screen.getByText("panel A"))).toBe(true);
    one.unmount();
    render(PEOPLE, ["A", "B"]);
    expect(follows(screen.getByText("merge"), screen.getByTestId("between"))).toBe(true);
    expect(follows(screen.getByTestId("between"), screen.getByText("panel A"))).toBe(true);
  });

  it("keeps the line for the Home person themselves, so nothing moves", () => {
    home.handle = "H";
    render(PEOPLE, ["H"]);
    expect(screen.getByTestId("between").textContent).toBe("H->H wait 300");
  });

  it("says nothing with no Home person, or off People", () => {
    home.handle = null;
    const b = render(PEOPLE, ["X"]);
    expect(screen.queryByTestId("between")).toBeNull();
    b.unmount();
    home.handle = "H";
    render(FAMILIES, ["F1", "F2"]);
    expect(screen.queryByTestId("between")).toBeNull();
  });
});
