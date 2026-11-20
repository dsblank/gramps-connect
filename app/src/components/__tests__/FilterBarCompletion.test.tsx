// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../testUtils/renderWithProviders";

const applyWhereExpr = vi.fn(async () => {});
vi.mock("../../hooks/useViewStore", () => ({ useViewStore: () => ({ whereExpr: null }) }));
vi.mock("../../store/registry", () => ({ getViewStore: () => ({ applyWhereExpr }) }));
vi.mock("../../store/searchHelp", () => ({ getSearchHelp: () => undefined }));
vi.mock("../../store/nameGroups", () => ({ useNameGroupsVersion: () => 0 }));
vi.mock("../../store/activityLog", () => ({ logActivity: () => {} }));

import { FilterBar } from "../FilterBar";
import type { ViewConfig } from "../../store/views";

// No simpleSearch, so the box is always GOQL -- like Tags.
// jsdom has no layout; Mantine scrolls the selected option into view.
Element.prototype.scrollIntoView ??= () => {};

// A fresh key per test: FilterBar keeps each view's typed text in
// searchState.ts across remounts.
let viewCount = 0;
// Mantine's dropdown is mid-transition, so "hidden" to a role query.
async function optionNames() {
  return (await screen.findAllByRole("option", { hidden: true })).map((o) => o.textContent);
}
async function expectClosed() {
  await waitFor(() => expect(screen.queryAllByRole("option", { hidden: true })).toHaveLength(0));
}

function setup() {
  const view = {
    key: `completion-test-${++viewCount}`,
    label: "People",
    endpoint: "/api/people/query/",
    wherePlaceholder: "",
  } as unknown as ViewConfig;
  renderWithProviders(<FilterBar view={view} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  return { input, user: userEvent.setup() };
}

describe("FilterBar GOQL Tab completion", () => {
  it("inserts a single match", async () => {
    const { input, user } = setup();
    await user.type(input, "birth.date.so");
    await user.keyboard("{Tab}");
    expect(input.value).toBe("birth.date.sortval");
    expect(document.activeElement).toBe(input);
    await expectClosed();
  });

  it("inserts the shared prefix, lists the rest, and picks with arrows + Enter", async () => {
    const { input, user } = setup();
    await user.type(input, "birth.date.modifier == Date.MOD_A");
    await user.keyboard("{Tab}");
    expect(await optionNames()).toEqual(["MOD_ABOUT", "MOD_AFTER"]);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input.value).toBe("birth.date.modifier == Date.MOD_AFTER");
    await expectClosed();
    expect(applyWhereExpr).not.toHaveBeenCalled();
  });

  it("narrows the list while typing, and Tab picks", async () => {
    const { input, user } = setup();
    await user.type(input, "gender == Person.");
    await user.keyboard("{Tab}");
    expect(await optionNames()).toEqual(["FEMALE", "MALE", "OTHER", "UNKNOWN"]);
    await user.type(input, "F");
    await waitFor(async () => expect(await optionNames()).toEqual(["FEMALE"]));
    await user.keyboard("{Tab}");
    expect(input.value).toBe("gender == Person.FEMALE");
  });

  it("completes mid-text without disturbing what follows", async () => {
    const { input, user } = setup();
    await user.type(input, "birth.date.so > 0");
    input.setSelectionRange(13, 13);
    await user.keyboard("{Tab}");
    expect(input.value).toBe("birth.date.sortval > 0");
    expect(input.selectionStart).toBe(18);
  });

  it("Escape closes the list; Tab with nothing to complete stays in the box, Shift+Tab leaves", async () => {
    const { input, user } = setup();
    await user.type(input, "bi");
    await user.keyboard("{Tab}");
    expect(input.value).toBe("birth");
    expect(await optionNames()).toEqual(["birth.→ Event", "birth_ref_indexcolumn"]);
    await user.keyboard("{Escape}");
    await expectClosed();
    await user.type(input, " == 'x");
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("birth == 'x");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).not.toBe(input);
  });

  it("Date( completes only the opening quote", async () => {
    const { input, user } = setup();
    await user.type(input, "birth.date.sortval > Date(");
    await user.keyboard("{Tab}");
    expect(input.value).toBe('birth.date.sortval > Date("');
  });

  it("typing after a Tab that completed nothing goes after the cursor", async () => {
    const { input, user } = setup();
    // `gender` is already the whole (only) match; `'x` is inside a string.
    for (const typed of ["gender", "surname == 'x"]) {
      await user.clear(input);
      await user.type(input, typed);
      await user.keyboard("{Tab}");
      await user.keyboard("q");
      expect(input.value).toBe(`${typed}q`);
      expect(input.selectionStart).toBe(typed.length + 1);
    }
  });

  it("a complete name with more parts gets its . or [ and lists what's next", async () => {
    const { input, user } = setup();
    await user.type(input, "primary_name.date");
    await user.keyboard("{Tab}");
    expect(input.value).toBe("primary_name.date.");
    expect(await optionNames()).toContain("dateval" + "array");
    // The open list narrows to `dateval[` as you type, so one Tab picks it.
    await user.type(input, "dateval");
    await user.keyboard("{Tab}");
    expect(input.value).toBe("primary_name.date.dateval[");
    expect(await optionNames()).toEqual(["0first item"]);
    await user.keyboard("{Tab}");
    expect(input.value).toBe("primary_name.date.dateval[0");
  });

  it("with no list open, Tab on a complete list field adds [", async () => {
    const { input, user } = setup();
    await user.type(input, "address_list");
    await user.keyboard("{Tab}");
    expect(input.value).toBe("address_list[");
    expect(await optionNames()).toEqual(["0first item"]);
  });

  it("a complete function name gets its ( and lists its argument", async () => {
    const { input, user } = setup();
    await user.type(input, "birth.date.sortval > Date");
    await user.keyboard("{Tab}");
    expect(await optionNames()).toEqual(["Date(function", "Date.constants"]);
    await user.keyboard("{Enter}");
    expect(input.value).toBe("birth.date.sortval > Date(");
    expect(await optionNames()).toEqual(['"text']);
    await user.keyboard("{Tab}");
    expect(input.value).toBe('birth.date.sortval > Date("');
  });

  it("a field holding named values offers only its class, then only the fitting values", async () => {
    const { input, user } = setup();
    await user.type(input, "birth.date.modifier == ");
    await user.keyboard("{Tab}");
    expect(input.value).toBe("birth.date.modifier == Date.");
    const names = await optionNames();
    expect(names).toHaveLength(9);
    expect(names.every((n) => n.startsWith("MOD_"))).toBe(true);
  });

  it("a text field gets its opening quote, a true/false field True/False", async () => {
    const { input, user } = setup();
    await user.type(input, "surname == ");
    await user.keyboard("{Tab}");
    expect(input.value).toBe('surname == "');
    await user.clear(input);
    await user.type(input, "private == ");
    await user.keyboard("{Tab}");
    expect(await optionNames()).toEqual(["Falsekeyword", "Truekeyword"]);
  });

  it("Enter with no list open still searches", async () => {
    const { input, user } = setup();
    await user.type(input, "gender == 1{Enter}");
    expect(applyWhereExpr).toHaveBeenCalledWith("gender == 1");
  });
});
