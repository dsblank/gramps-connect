// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import type { ObjectDetail } from "../../../store/objectDetail";
import { PERSON_VIEW } from "../../../store/views";
import { STORAGE_KEYS } from "../../../store/storageKeys";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../store/apiFetch", () => ({ apiFetch }));
vi.mock("../../../auth/auth", () => ({ getToken: async () => "tok", hasPermissions: () => false }));

import { CitationsSection } from "../sections/CitationsSection";

const CITATIONS: Record<string, unknown> = {
  C1: { handle: "C1", page: "p. 12", confidence: 2, extended: { source: { handle: "S1", title: "Parish Register" } } },
  C2: { handle: "C2", page: "Folio 3", confidence: 4, extended: { source: { handle: "S1", title: "Parish Register" } } },
  C3: { handle: "C3", page: "Line 7", confidence: 2, extended: { source: { handle: "S2", title: "1850 Census" } } },
};

function personWith(handles: { own: string[]; event: string[] }): ObjectDetail {
  return {
    handle: "P1",
    citation_list: handles.own,
    event_ref_list: [{ ref: "E1", role: "Primary", citation_list: [] }],
    extended: { events: [{ handle: "E1", type: "Birth", citation_list: handles.event }] },
  } as unknown as ObjectDetail;
}

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset().mockImplementation(async (url: string) => {
    const handles = decodeURIComponent(new URL(url, "http://x").searchParams.get("handles") ?? "").split(",");
    return new Response(JSON.stringify(handles.map((h) => CITATIONS[h]).filter(Boolean)), { status: 200 });
  });
});

describe("CitationsSection", () => {
  it("starts closed with a count and fetches nothing", () => {
    renderWithProviders(
      <CitationsSection type="person" view={PERSON_VIEW} detail={personWith({ own: ["C1"], event: ["C3"] })} onNavigate={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Citations/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("· 2")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("opens with one request, groups by source, labels event citations, and remembers being open", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderWithProviders(
      <CitationsSection type="person" view={PERSON_VIEW} detail={personWith({ own: ["C1", "C2"], event: ["C3"] })} onNavigate={onNavigate} />,
    );
    await user.click(screen.getByRole("button", { name: /Citations/ }));

    expect(await screen.findByText("Parish Register")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toContain("extend=source_handle");
    expect(screen.getByText("1850 Census")).toBeInTheDocument();
    expect(screen.getByText("p. 12")).toBeInTheDocument();
    // Confidence shown only when it isn't Normal.
    expect(screen.getByText("Folio 3 · Very High")).toBeInTheDocument();
    // Sources sorted by title: the census group comes first.
    const census = screen.getByText("1850 Census");
    const parish = screen.getByText("Parish Register");
    expect(census.compareDocumentPosition(parish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Birth/ }));
    expect(onNavigate).toHaveBeenCalledWith("event", "E1");

    expect(localStorage.getItem(STORAGE_KEYS.citationsSectionOpen)).toBe("1");
  });

  it("reuses the cached result when the same citations are shown again", async () => {
    localStorage.setItem(STORAGE_KEYS.citationsSectionOpen, "1");
    const detail = personWith({ own: ["C2"], event: [] });
    const { unmount } = renderWithProviders(
      <CitationsSection type="person" view={PERSON_VIEW} detail={detail} onNavigate={vi.fn()} />,
    );
    expect(await screen.findByText("Folio 3 · Very High")).toBeInTheDocument();
    unmount();
    renderWithProviders(<CitationsSection type="person" view={PERSON_VIEW} detail={detail} onNavigate={vi.fn()} />);
    expect(screen.getByText("Folio 3 · Very High")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
