// @vitest-environment jsdom
// Built-in saved filters in the Filters dialog: picked like any saved
// filter, edited into a tree copy with the same id, restored, hidden.
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
const media = vi.hoisted(() => ({
  uploadSavedFilter: vi.fn(async () => "new-handle"),
  removeSavedFilter: vi.fn(async () => {}),
}));
vi.mock("../../store/savedFilterMedia", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSavedFilters: vi.fn(async () => []),
  uploadSavedFilter: media.uploadSavedFilter,
  removeSavedFilter: media.removeSavedFilter,
}));
vi.mock("../../auth/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getToken: vi.fn(async () => "token"),
  getTreeId: () => "tree-1",
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

const chooser = () => screen.getByRole("textbox", { name: "Choose a filter…" });

async function pick(user: ReturnType<typeof userEvent.setup>, search: string, option: string) {
  await user.click(chooser());
  await user.clear(chooser());
  await user.type(chooser(), search);
  await user.click(await screen.findByRole("option", { name: option, hidden: true }));
}

describe("built-in saved filters in the Filters dialog", () => {
  beforeEach(() => {
    localStorage.clear();
    store.snapshot.pickerExpr = null;
    store.setPickerFilter.mockClear();
    media.uploadSavedFilter.mockClear();
    media.removeSavedFilter.mockClear();
  });

  it("applies a built-in with Apply, writing nothing to the tree", async () => {
    const user = setup();
    await pick(user, "Research", "Research gaps");
    expect(chooser()).toHaveValue("Research gaps");
    await user.click(screen.getByRole("button", { name: /^Apply/ }));
    await waitFor(() => expect(store.setPickerFilter).toHaveBeenCalledTimes(1));
    expect(store.setPickerFilter.mock.calls[0][0]).toMatch(/parent_families/);
    expect(media.uploadSavedFilter).not.toHaveBeenCalled();
  });

  it("saving an edit writes a tree copy with the same id, which Restore original deletes", async () => {
    const user = setup();
    await pick(user, "Research", "Research gaps");
    await user.click(screen.getByRole("button", { name: /Edit options/ }));
    // Negate the whole filter: an edit.
    await user.click(screen.getAllByRole("checkbox", { name: "NOT", hidden: true })[0]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(media.uploadSavedFilter).toHaveBeenCalledTimes(1));
    const [saved] = media.uploadSavedFilter.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(saved).toMatchObject({ id: "builtin-research-gaps", name: "Research gaps" });
    expect(saved.builtinHash).toMatch(/^[0-9a-f]{8}$/);
    expect(chooser()).toHaveValue("Research gaps (edited)");

    await user.click(screen.getByRole("button", { name: "Restore original" }));
    await waitFor(() => expect(media.removeSavedFilter).toHaveBeenCalledWith("new-handle"));
    expect(chooser()).toHaveValue("Research gaps");
  });

  it("Hide takes a built-in out of the list until shown again", async () => {
    const user = setup();
    await pick(user, "Research", "Research gaps");
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(chooser()).toHaveValue("");
    expect(chooser()).toHaveAttribute("placeholder", "Choose a filter…");
    await user.click(chooser());
    await user.clear(chooser());
    await user.type(chooser(), "Research");
    expect(screen.queryByRole("option", { name: "Research gaps", hidden: true })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Show hidden built-in filters \(1\)/ }));
    await user.click(chooser());
    await user.clear(chooser());
    await user.type(chooser(), "Research");
    expect(await screen.findByRole("option", { name: "Research gaps", hidden: true })).toBeTruthy();
  });
});
