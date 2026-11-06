// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../testUtils/renderWithProviders";

const PAGES: Record<string, string> = {
  _Sidebar: "**[Home](Home)**\n\n- [Maps](Maps)\n- [Charts](Charts)\n- [Map overlays](Maps#overlays)\n",
  Home: "# Home\n\nSee [the charts page](Charts).\n",
  Maps: "# Maps\n\n## Overlays\n\ntext\n",
  Charts: "# Charts\n\nBack to [maps](Maps).\n",
};

vi.mock("../../store/wikiDocsApi", () => ({
  fetchWikiPage: vi.fn(async (page: string) => ({ markdown: PAGES[page] ?? "# Missing", lang: "en" })),
  wikiPageGithubUrl: () => "https://example.invalid/",
}));

import { DocumentationDialog } from "../DocumentationDialog";

function current(): string[] {
  return [...document.querySelectorAll('a[aria-current="page"]')].map((a) => a.textContent ?? "");
}

describe("DocumentationDialog sidebar", () => {
  it("marks the link for the page on screen, following links and Back", async () => {
    // jsdom has no layout, so no scrollIntoView/scrollTo.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
    renderWithProviders(<DocumentationDialog opened onClose={() => {}} />);
    await waitFor(() => expect(current()).toEqual(["Home"]));

    await userEvent.click(await screen.findByText("the charts page"));
    await waitFor(() => expect(current()).toEqual(["Charts"]));

    // A link to a section of a page doesn't mark itself; the page link does.
    await userEvent.click(screen.getByText("Map overlays"));
    await waitFor(() => expect(current()).toEqual(["Maps"]));

    await userEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(current()).toEqual(["Charts"]));
  });
});
