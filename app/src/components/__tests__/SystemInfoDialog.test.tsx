// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn(async () => "tok") }));
vi.mock("../../store/metadataApi", async () => {
  const actual = await vi.importActual<typeof import("../../store/metadataApi")>("../../store/metadataApi");
  return { ...actual, fetchMetadata: vi.fn() };
});

import { fetchMetadata } from "../../store/metadataApi";
import { SystemInfoDialog } from "../SystemInfoDialog";

describe("SystemInfoDialog", () => {
  beforeEach(() => vi.mocked(fetchMetadata).mockReset());

  it("shows deprecated server settings in full when the server sends them", async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({
      gramps_webapi: { version: "3.23.0" },
      deprecations: [
        {
          option: "TREE",
          replacement: "GRAMPSWEB_TREE",
          message: "Setting `TREE` via the environment is deprecated.",
          removed_in: "4.0.0",
        },
      ],
    });
    renderWithProviders(<SystemInfoDialog opened onClose={() => {}} />);
    expect(await screen.findByText("Warnings")).toBeTruthy();
    expect(screen.getByText("Support will be removed in Gramps Web API 4.0.0.")).toBeTruthy();
    // the message's `TREE` is rendered as code, not with literal backticks
    expect(screen.queryByText(/`TREE`/)).toBeNull();
    // and the setting is in the copyable block too
    expect(screen.getByText(/deprecated setting: TREE -> GRAMPSWEB_TREE/)).toBeTruthy();
  });

  it("shows no warnings section otherwise", async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({ gramps_webapi: { version: "3.23.0" } });
    renderWithProviders(<SystemInfoDialog opened onClose={() => {}} />);
    expect(await screen.findByText(/Gramps Web API 3.23.0/)).toBeTruthy();
    expect(screen.queryByText("Warnings")).toBeNull();
  });
});
