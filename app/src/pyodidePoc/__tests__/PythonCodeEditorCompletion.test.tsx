// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import { PythonCodeEditor } from "../PythonCodeEditor";

Element.prototype.scrollIntoView ??= () => {};

async function optionNames() {
  return (await screen.findAllByRole("option", { hidden: true })).map((o) => o.textContent);
}

function setup(initial = "") {
  function Host() {
    const [code, setCode] = useState(initial);
    return <PythonCodeEditor value={code} onChange={setCode} />;
  }
  const { container } = renderWithProviders(<Host />);
  const field = container.querySelector("textarea") as HTMLTextAreaElement;
  return { field, user: userEvent.setup() };
}

describe("Gramplet code editor GOQL completion", () => {
  it("completes inside a people() where string", async () => {
    const { field, user } = setup();
    await user.click(field);
    await user.type(field, 'people("birth.date.so');
    await user.keyboard("{Tab}");
    expect(field.value).toBe('people("birth.date.sortval');
  });

  it("uses the type from filter()'s first argument and lists the next names", async () => {
    const { field, user } = setup();
    await user.click(field);
    await user.type(field, 'filter("Event", "type.value == ');
    await user.keyboard("{Tab}");
    expect(field.value).toBe('filter("Event", "type.value == EventType.');
    expect(await optionNames()).toContain("BIRTH");
  });

  it("suggests the other quote inside a Python string", async () => {
    const { field, user } = setup();
    await user.click(field);
    await user.type(field, 'people("birth.date.sortval > Date(');
    await user.keyboard("{Tab}");
    expect(field.value).toBe("people(\"birth.date.sortval > Date('");
  });

  it("Tab outside a GOQL string still indents", async () => {
    const { field, user } = setup();
    await user.click(field);
    await user.type(field, 'print("x")');
    await user.keyboard("{Tab}");
    expect(field.value).toBe('print("x")    ');
  });
});
