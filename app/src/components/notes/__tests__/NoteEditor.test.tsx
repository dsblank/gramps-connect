// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";

vi.mock("../../../auth/auth", () => ({
  getToken: vi.fn(async () => "tok"),
  hasPermissions: vi.fn(() => true),
  getTreeId: vi.fn(() => null),
  getCurrentUsername: vi.fn(() => "tester"),
}));

import { NoteEditor } from "../NoteEditor";
import { NoteText } from "../../related/NoteText";
import type { StyledText } from "../../../store/styledText";

const FORMATTED: StyledText = {
  string: "Born in Berlin\nsecond line",
  tags: [
    { name: "bold", value: null, ranges: [[0, 4]] },
    { name: "link", value: "gramps://Person/handle/P1", ranges: [[8, 14]] },
  ],
};

describe("NoteEditor", () => {
  it("shows stored formatting and reports the toolbar's changes as StyledText", async () => {
    let latest: StyledText | null = null;
    function Host() {
      const [value, setValue] = useState<StyledText>(FORMATTED);
      return <NoteEditor value={value} onChange={(v) => { latest = v; setValue(v); }} />;
    }
    const { container } = renderWithProviders(<Host />);
    const pm = container.querySelector(".ProseMirror")!;
    expect(pm.querySelector("strong")?.textContent).toBe("Born");
    expect(pm.querySelector("a")?.getAttribute("href")).toBe("gramps://Person/handle/P1");
    expect(pm.querySelectorAll("p")).toHaveLength(2);

    // Select everything, then Italic from the toolbar.
    const user = userEvent.setup();
    (pm as HTMLElement).focus();
    const editorEl = pm as HTMLElement & { editor?: { commands: { selectAll: () => void } } };
    editorEl.editor?.commands.selectAll();
    await user.click(screen.getByRole("button", { name: /italic/i }));
    expect(latest).not.toBeNull();
    const italic = latest!.tags!.find((t) => t.name === "italic");
    expect(italic?.ranges).toEqual([[0, 26]]);
    expect(latest!.tags!.find((t) => t.name === "bold")?.ranges).toEqual([[0, 4]]);
  });
});

describe("NoteText", () => {
  it("renders Gramps formatting and record links", async () => {
    const onNavigate = vi.fn();
    const { container } = renderWithProviders(
      <NoteText
        text={{ ...FORMATTED, tags: [...FORMATTED.tags!, { name: "fontcolor", value: "#ff0000", ranges: [[15, 21]] }] }}
        onNavigate={onNavigate}
      />
    );
    const root = container.querySelector("span[style*='pre-wrap']")!;
    expect(root.textContent).toBe("Born in Berlin\nsecond line");
    const bold = [...container.querySelectorAll("span")].find((s) => s.style.fontWeight === "700");
    expect(bold?.textContent).toBe("Born");
    const red = [...container.querySelectorAll("span")].find((s) => s.style.color === "rgb(255, 0, 0)");
    expect(red?.textContent).toBe("second");
    await userEvent.setup().click(screen.getByRole("button", { name: "Berlin" }));
    expect(onNavigate).toHaveBeenCalledWith("person", "P1");
  });
});
