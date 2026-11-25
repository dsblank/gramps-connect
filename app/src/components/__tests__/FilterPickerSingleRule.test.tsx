// @vitest-environment jsdom
// Issue #60: any rule can be picked from "Choose a filter…" and used on its
// own, without building a filter first.
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../testUtils/renderWithProviders";

const store = vi.hoisted(() => {
  const snapshot = { pickerExpr: null as string | null };
  return {
    snapshot,
    setPickerFilter: vi.fn(async (expr: string) => { snapshot.pickerExpr = expr; }),
    clearPickerFilter: vi.fn(async () => { snapshot.pickerExpr = null; }),
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
  };
});

vi.mock("../../store/registry", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getViewStore: () => store,
}));
vi.mock("../../store/customRuleMedia", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshCustomRules: vi.fn(async () => []),
}));
vi.mock("../../store/savedFilterMedia", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSavedFilters: vi.fn(async () => []),
}));
vi.mock("../../auth/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getToken: vi.fn(async () => "token"),
}));
vi.mock("../../store/bookmarks", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBookmarks: vi.fn(async () => {}),
}));
vi.mock("../../store/activityLog", () => ({ logActivity: vi.fn() }));

import { FilterPickerDialog } from "../FilterPickerDialog";

Element.prototype.scrollIntoView ??= () => {};

function setup() {
  renderWithProviders(
    <FilterPickerDialog opened onClose={() => {}} viewKey="person" viewLabel="People" namespace="Person" />,
  );
  return userEvent.setup();
}

async function pick(user: ReturnType<typeof userEvent.setup>, search: string, option: string) {
  const select = screen.getByRole("textbox", { name: "Choose a filter…" });
  await user.click(select);
  await user.clear(select);
  await user.type(select, search);
  await user.click(await screen.findByRole("option", { name: option, hidden: true }));
}

describe("Choose a filter… single rules", () => {
  beforeEach(() => {
    store.snapshot.pickerExpr = null;
    store.setPickerFilter.mockClear();
  });

  it("applies a picked rule only when Apply is pressed", async () => {
    const user = setup();
    await pick(user, "Fema", "Females");
    expect(screen.getByRole("textbox", { name: "Choose a filter…" })).toHaveValue("Females");
    expect(store.setPickerFilter).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Apply/ }));
    await waitFor(() => expect(store.setPickerFilter).toHaveBeenCalledTimes(1));
    expect(store.setPickerFilter.mock.calls[0][0]).toMatch(/gender/);
  });

  it("asks for a rule's values before applying it", async () => {
    const user = setup();
    await pick(user, "Birth date betw", "Birth date between");
    expect(store.setPickerFilter).not.toHaveBeenCalled();
    // The collapsed Filter Builder keeps its own copy of the inputs in the
    // page (hidden); the one under the dropdown comes first.
    const [first] = await screen.findAllByPlaceholderText("Start date");
    expect(document.activeElement).toBe(first);
    await user.type(first, "1800");
    await user.type(screen.getAllByPlaceholderText("End date")[0], "1850");
    await user.click(screen.getByRole("button", { name: /^Apply/ }));
    await waitFor(() => expect(store.setPickerFilter).toHaveBeenCalledTimes(1));
    expect(store.setPickerFilter.mock.calls[0][0]).toMatch(/1800.*1850/s);
  });
});
