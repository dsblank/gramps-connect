// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import type { ObjectDetail } from "../../../store/objectDetail";
import { PERSON_VIEW, PLACE_VIEW } from "../../../store/views";

const queryWithOrderBy = vi.hoisted(() => vi.fn());
vi.mock("../../../store/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/api")>()),
  queryWithOrderBy,
}));
vi.mock("../../../auth/auth", () => ({ getToken: async () => "tok", hasPermissions: () => false }));

import { BacklinksSection } from "../sections/BacklinksSection";

const name = (first: string, surname: string) => ({ first_name: first, surname_list: [{ surname, primary: true }] });
const ref = (event: string, value: number) => ({ ref: event, role: { _class: "EventRoleType", string: "", value } });

const PEOPLE = [
  // Primary in the birth; only a witness at the marriage.
  { handle: "P1", primary_name: name("John", "Smith"), event_ref_list: [ref("E1", 1), ref("E2", 7)] },
];
const FAMILIES = [
  { handle: "F1", father_name: name("Tom", "Brown"), mother_name: name("Ann", "Green"), event_ref_list: [ref("E2", 8)] },
];

beforeEach(() => {
  queryWithOrderBy.mockReset().mockImplementation(async (url: string) => {
    const items = url.includes("/api/people/") ? PEOPLE : FAMILIES;
    return new Response(JSON.stringify({ items, next_after: null }), { status: 200 });
  });
});

describe("BacklinksSection", () => {
  it("adds the primary people and families to event rows", async () => {
    const detail = {
      handle: "PL1",
      extended: {
        backlinks: {
          event: [
            { handle: "E1", gramps_id: "E0001", type: "Birth" },
            { handle: "E2", gramps_id: "E0002", type: "Marriage" },
          ],
        },
      },
    } as unknown as ObjectDetail;
    renderWithProviders(<BacklinksSection type="place" view={PLACE_VIEW} detail={detail} onNavigate={vi.fn()} />);

    expect(await screen.findByText(/\[E0001\] Birth · .*John/)).toBeInTheDocument();
    // The witness isn't named; the couple are, each with their own surname.
    const marriage = screen.getByText(/\[E0002\] Marriage · /).textContent ?? "";
    expect(marriage).not.toMatch(/John/);
    expect(marriage).toMatch(/· [^&]*(Tom|Brown)[^&]* & [^&]*(Ann|Green)/);
    // One people query and one families query, for both events at once.
    expect(queryWithOrderBy).toHaveBeenCalledTimes(2);
  });

  it("shows the association's description after a person's name", () => {
    const detail = {
      handle: "P9",
      extended: {
        backlinks: {
          person: [
            { handle: "P2", gramps_id: "I0002", primary_name: name("Jane", "Doe"), person_ref_list: [{ ref: "P9", rel: "Godmother" }] },
            { handle: "P3", gramps_id: "I0003", primary_name: name("Bob", "Roe"), person_ref_list: [{ ref: "P9", rel: "" }] },
          ],
        },
      },
    } as unknown as ObjectDetail;
    renderWithProviders(<BacklinksSection type="person" view={PERSON_VIEW} detail={detail} onNavigate={vi.fn()} />);

    expect(screen.getByText(/\[I0002\] .*Jane.* \(Godmother\)$/)).toBeInTheDocument();
    expect(screen.getByText(/\[I0003\] .*Bob[^(]*$/)).toBeInTheDocument();
    expect(queryWithOrderBy).not.toHaveBeenCalled();
  });
});
