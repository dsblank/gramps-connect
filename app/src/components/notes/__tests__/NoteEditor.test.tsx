// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { act, fireEvent } from "@testing-library/react";
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

describe("NoteEditor preformatted", () => {
  // jsdom has no layout: give ProseMirror's scroll-into-view after a typed
  // Tab the empty rects a browser would compute, instead of crashing.
  const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) });
  for (const proto of [Range.prototype, Element.prototype, Text.prototype] as unknown as Record<string, unknown>[]) {
    proto.getClientRects ??= () => [];
    proto.getBoundingClientRect ??= emptyRect;
  }
  function setup(initialPreformatted: boolean) {
    let latest: StyledText | null = null;
    let setPre: (v: boolean) => void = () => {};
    function Host() {
      const [value, setValue] = useState<StyledText>({ string: "a\tb", tags: [] });
      const [pre, setPreState] = useState(initialPreformatted);
      setPre = setPreState;
      return <NoteEditor value={value} preformatted={pre} onChange={(v) => { latest = v; setValue(v); }} />;
    }
    const { container } = renderWithProviders(<Host />);
    const pm = container.querySelector(".ProseMirror") as HTMLElement & {
      editor?: { commands: { setTextSelection: (pos: number) => void } };
    };
    const pressTabAtStart = (init: KeyboardEventInit = {}) => {
      pm.focus();
      pm.editor?.commands.setTextSelection(1);
      fireEvent.keyDown(pm, { key: "Tab", code: "Tab", ...init });
    };
    return { container, pm, pressTabAtStart, latest: () => latest, setPre: (v: boolean) => act(() => setPre(v)) };
  }

  it("Tab types a tab character in a preformatted note", () => {
    const { container, pressTabAtStart, latest } = setup(true);
    expect(container.querySelector("[class*='preformatted']")).not.toBeNull();
    pressTabAtStart();
    expect(latest()?.string).toBe("\ta\tb");
  });

  it("Tab is left alone in a flowed note, and Shift+Tab always is", () => {
    const { container, pressTabAtStart, latest } = setup(false);
    expect(container.querySelector("[class*='preformatted']")).toBeNull();
    pressTabAtStart();
    pressTabAtStart({ shiftKey: true });
    expect(latest()).toBeNull();
  });

  it("follows the flag when it's switched on in an open editor", () => {
    const { container, pressTabAtStart, latest, setPre } = setup(false);
    setPre(true);
    expect(container.querySelector("[class*='preformatted']")).not.toBeNull();
    pressTabAtStart();
    expect(latest()?.string).toBe("\ta\tb");
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
