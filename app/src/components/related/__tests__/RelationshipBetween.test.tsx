// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent } from "../../../testUtils/renderWithProviders";
import type { RelationshipPathsState } from "../../../store/relationshipPathsApi";

const hook = vi.hoisted(() => ({ state: { status: "idle" } as RelationshipPathsState, calls: [] as unknown[][] }));
vi.mock("../../../store/relationshipPathsApi", () => ({
  useRelationshipPaths: (...args: unknown[]) => {
    hook.calls.push(args);
    return hook.state;
  },
}));
vi.mock("../../../pyodidePoc/RelationshipChart", () => ({
  usePeople: () =>
    new Map([
      ["H", { name: "Home, Hal", birth: null, death: null }],
      ["X", { name: "Cousin, Xena", birth: null, death: null }],
    ]),
  RelationshipChart: ({ paths }: { paths: unknown[] }) => <div data-testid="chart">{paths.length} paths</div>,
}));
const opened = vi.hoisted(() => [] as [string, string][]);
vi.mock("../../../store/relationshipWindow", () => ({
  openRelationshipWindow: (from: string, to: string) => opened.push([from, to]),
}));
const home = vi.hoisted(() => ({ handle: null as string | null }));
vi.mock("../../../store/homePersonPreference", () => ({ getHomePersonHandle: () => home.handle }));

import { HomeRelationshipLine, RelationshipBetween } from "../RelationshipBetween";

const COUSIN = {
  steps: [
    { handle: "H", link: null, gender: 1, relationship_string: "", label: "" },
    { handle: "X", link: "child" as const, gender: 0, relationship_string: "", label: "first cousin" },
  ],
};

beforeEach(() => {
  opened.length = 0;
  hook.calls = [];
  home.handle = null;
});

describe("RelationshipBetween", () => {
  it("says how the second person is related to the first, and opens the window on the two", () => {
    hook.state = { status: "done", paths: [COUSIN, COUSIN] };
    renderWithProviders(<RelationshipBetween from="H" to="X" revision={0} />);
    expect(screen.getByText(/Cousin, Xena is Home, Hal's/)).toBeTruthy();
    expect(screen.getByText("first cousin").tagName).toBe("B");
    expect(screen.queryByTestId("chart")).toBeNull();
    fireEvent.click(screen.getByText("Show chart"));
    expect(opened).toEqual([["H", "X"]]);
    expect(screen.queryByTestId("chart")).toBeNull();
  });

  it("draws the chart below, with no Show chart, when always open", () => {
    hook.state = { status: "done", paths: [COUSIN, COUSIN] };
    renderWithProviders(<RelationshipBetween from="H" to="X" revision={0} chart="always" />);
    expect(screen.getByTestId("chart").textContent).toBe("2 paths");
    expect(screen.queryByText("Show chart")).toBeNull();
  });

  it("says when they aren't related, and shows a search in progress", () => {
    hook.state = { status: "done", paths: [] };
    const { unmount } = renderWithProviders(<RelationshipBetween from="H" to="X" revision={0} />);
    expect(screen.getByText("Cousin, Xena and Home, Hal aren't related within 15 links.")).toBeTruthy();
    unmount();
    hook.state = { status: "loading" };
    renderWithProviders(<RelationshipBetween from="H" to="X" revision={0} />);
    expect(screen.getByText("Finding how they're related...")).toBeTruthy();
  });
});

describe("HomeRelationshipLine", () => {
  it("shows nothing with no Home person set", () => {
    hook.state = { status: "done", paths: [COUSIN] };
    renderWithProviders(<HomeRelationshipLine handle="X" revision={0} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the relationship to the Home person, waiting before it asks, and opens the window", () => {
    home.handle = "H";
    hook.state = { status: "done", paths: [COUSIN] };
    renderWithProviders(<HomeRelationshipLine handle="X" revision={4} />);
    expect(hook.calls[0]).toEqual(["H", "X", { revision: 4, delayMs: 300 }]);
    fireEvent.click(screen.getByText("Home person's first cousin"));
    expect(opened).toEqual([["H", "X"]]);
  });

  it("shows nothing for someone not related", () => {
    home.handle = "H";
    hook.state = { status: "done", paths: [] };
    renderWithProviders(<HomeRelationshipLine handle="X" revision={0} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
