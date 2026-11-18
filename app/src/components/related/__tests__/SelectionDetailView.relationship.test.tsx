// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import type { ViewConfig } from "../../../store/views";

vi.mock("../../RelatedPanel", () => ({ RelatedPanel: ({ handle }: { handle: string }) => <div>{`panel ${handle}`}</div> }));
vi.mock("../AddButton", () => ({ AddButton: () => null }));
vi.mock("../MergeButton", () => ({ MergeButton: () => <button>merge</button> }));
vi.mock("../BulkDeleteButton", () => ({ BulkDeleteButton: () => null }));
vi.mock("../BulkTagButton", () => ({ BulkTagButton: () => null }));
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("../RelationshipBetween", async () => {
  const { useEffect } = await import("react");
  return {
    RelationshipBetween: ({ from, to, delayMs }: { from: string; to: string; delayMs?: number }) => {
      useEffect(() => {
        mounts.count++;
      }, []);
      return <div data-testid="between">{`${from}->${to} wait ${delayMs ?? 0}`}</div>;
    },
  };
});
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

  it("is in one place for both: above the two-person buttons, updated in place on a second pick", () => {
    home.handle = "H";
    mounts.count = 0;
    const { rerender } = render(PEOPLE, ["A"]);
    expect(screen.getByTestId("between").textContent).toBe("H->A wait 300");
    rerender(<SelectionDetailView view={PEOPLE} handles={["A", "B"]} revision={0} onNavigate={() => {}} />);
    expect(screen.getByTestId("between").textContent).toBe("A->B wait 0");
    expect(mounts.count).toBe(1);
    const between = screen.getByTestId("between");
    const merge = screen.getByText("merge");
    expect(between.compareDocumentPosition(merge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says nothing for the Home person themselves, with no Home person, or off People", () => {
    home.handle = "H";
    const a = render(PEOPLE, ["H"]);
    expect(screen.queryByTestId("between")).toBeNull();
    a.unmount();
    home.handle = null;
    const b = render(PEOPLE, ["X"]);
    expect(screen.queryByTestId("between")).toBeNull();
    b.unmount();
    home.handle = "H";
    render(FAMILIES, ["F1", "F2"]);
    expect(screen.queryByTestId("between")).toBeNull();
  });
});
