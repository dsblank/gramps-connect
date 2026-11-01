// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import type { ObjectDetail } from "../../../store/objectDetail";

vi.mock("../../../store/lifeEventDates", () => ({
  lifeEventYear: (_obj: unknown, which: string) => (which === "birth" ? "1832" : ""),
  lifeEventPlace: () => "",
}));

import { ExternalSearchButton } from "../ExternalSearchButton";

const detail = {
  handle: "P1",
  primary_name: { first_name: "Johann", surname_list: [{ surname: "Schmidt", primary: true }] },
} as unknown as ObjectDetail;

const link = (name: string) => screen.getByText(name).closest("a") as HTMLAnchorElement;

describe("ExternalSearchButton", () => {
  beforeEach(() => localStorage.clear());

  it("lists links filled with the person's terms, and edited terms change them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExternalSearchButton detail={detail} />);
    await user.click(screen.getByRole("button", { name: "External Search" }));

    expect(await screen.findByText("Johann Schmidt · 1832–")).toBeTruthy();
    expect(link("Geni").href).toBe("https://www.geni.com/search?search_type=people&names=Johann%20Schmidt");
    expect(link("Geni").target).toBe("_blank");
    expect(screen.queryByText("CompGen")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const surname = screen.getByLabelText("Surname");
    await user.clear(surname);
    await user.type(surname, "Schmitt");
    expect(link("Geni").href).toContain("names=Johann%20Schmitt");
  });

  it("adds a suggested site once, and it then shows in the list", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExternalSearchButton detail={detail} />);
    await user.click(screen.getByRole("button", { name: "External Search" }));
    await user.click(await screen.findByRole("button", { name: "Customize…" }));

    const row = screen.getByText("CompGen").parentElement!.parentElement!;
    const add = row.querySelector("button")!;
    await user.click(add);
    expect(add.textContent).toBe("Added");
    expect((add as HTMLButtonElement).disabled).toBe(true);

    // Hide a built-in on the way out.
    await user.click(screen.getByRole("switch", { name: "Ancestry" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(link("CompGen").href).toBe("https://meta.genealogy.net/search?lastname=Schmidt&place=");
    expect(screen.queryByText("Ancestry")).toBeNull();
    expect(JSON.parse(localStorage.getItem("gramps-connect_external_search")!).hidden).toEqual(["ancestry"]);
  });
});
