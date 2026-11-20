// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";

vi.mock("../../store/customRuleMedia", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  validateWhereExpr: vi.fn(async () => ({ ok: true })),
}));

import { CustomRuleForm } from "../FilterPickerDialog";

Element.prototype.scrollIntoView ??= () => {};

async function optionNames() {
  return (await screen.findAllByRole("option", { hidden: true })).map((o) => o.textContent);
}

function setup() {
  renderWithProviders(
    <CustomRuleForm
      namespace="Person"
      initialName=""
      initialWhereExpr=""
      initialParams={[]}
      submitLabel="Save"
      onSubmit={async () => {}}
      onCancel={() => {}}
    />,
  );
  const field = screen.getByPlaceholderText(/Tab> completes/) as HTMLTextAreaElement;
  return { field, user: userEvent.setup() };
}

describe("Custom Rule expression Tab completion", () => {
  it("completes, and stays in the field", async () => {
    const { field, user } = setup();
    await user.type(field, "birth.date.so");
    await user.keyboard("{Tab}");
    expect(field.value).toBe("birth.date.sortval");
    expect(document.activeElement).toBe(field);
  });

  it("reads a {param} placeholder as a value", async () => {
    const { field, user } = setup();
    // user.type treats { as a key descriptor; {{ types a literal brace.
    await user.type(field, "birth.date.sortval < {{minAge} ");
    await user.keyboard("{Tab}");
    expect(await optionNames()).toEqual(expect.arrayContaining(["andkeyword", "orkeyword"]));
  });

  it("offers the coded field's named values", async () => {
    const { field, user } = setup();
    await user.type(field, "gender == ");
    await user.keyboard("{Tab}");
    expect(field.value).toBe("gender == Person.");
    expect(await optionNames()).toHaveLength(4);
  });
});
