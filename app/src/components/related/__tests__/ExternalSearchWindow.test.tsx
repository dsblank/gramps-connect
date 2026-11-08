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
import { ExternalSearchWindow } from "../ExternalSearchWindow";
import { act } from "../../../testUtils/renderWithProviders";
import { closeExternalSearchWindow } from "../../../store/externalSearchWindow";
import { STORAGE_KEYS } from "../../../store/storageKeys";

const detail = {
  handle: "P1",
  primary_name: { first_name: "Johann", surname_list: [{ surname: "Schmidt", primary: true }] },
} as unknown as ObjectDetail;

const other = {
  handle: "P2",
  primary_name: { first_name: "Anna", surname_list: [{ surname: "Weber", primary: true }] },
} as unknown as ObjectDetail;

/** The button on a person's panel, plus the window App.tsx mounts once. */
function renderPanel(person: ObjectDetail = detail) {
  return renderWithProviders(
    <>
      <ExternalSearchButton detail={person} />
      <ExternalSearchWindow />
    </>
  );
}

const link = (name: string) => screen.getByText(name).closest("a") as HTMLAnchorElement;

describe("External Search window", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => closeExternalSearchWindow());
  });

  it("lists links filled with the person's terms, and edited terms change them", async () => {
    const user = userEvent.setup();
    renderPanel();
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
    renderPanel();
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
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.externalSearch)!).hidden).toEqual(["ancestry"]);
  });

  it("is a non-modal window: opening it from another person switches it, and it minimizes to a chip", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await user.click(screen.getByRole("button", { name: "External Search" }));
    expect(await screen.findByRole("dialog", { name: "External Search: Johann Schmidt" })).toBeTruthy();

    // Edited terms are for this opening only.
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Surname"));
    await user.type(screen.getByLabelText("Surname"), "Schmitt");

    rerender(
      <>
        <ExternalSearchButton detail={other} />
        <ExternalSearchWindow />
      </>
    );
    await user.click(screen.getByRole("button", { name: "External Search" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "External Search: Anna Weber" })).toBeTruthy();
    expect(link("Geni").href).toContain("names=Anna%20Weber");

    await user.click(screen.getByRole("button", { name: "Minimize" }));
    expect((screen.getByRole("dialog", { hidden: true }) as HTMLElement).style.display).toBe("none");
    await user.click(screen.getAllByRole("button", { name: "Show" })[0]);
    expect((screen.getByRole("dialog") as HTMLElement).style.display).toBe("flex");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
