// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn(async () => "tok"),
  hasPermissions: vi.fn(() => true),
  getApiKey: vi.fn(() => "refresh*url"),
  composeApiKey: vi.fn((token: string) => `${token}*encoded-url`),
}));
vi.mock("../../store/apiKeysApi", async () => {
  const actual = await vi.importActual<typeof import("../../store/apiKeysApi")>("../../store/apiKeysApi");
  return { ...actual, listApiKeys: vi.fn(), createApiKey: vi.fn(), deleteApiKey: vi.fn() };
});
vi.mock("../../store/confirmDialog", () => ({ confirmDialog: vi.fn(async () => true) }));

import { ApiKeysUnsupported, createApiKey, deleteApiKey, listApiKeys } from "../../store/apiKeysApi";
import { ApiKeysDialog } from "../ApiKeysDialog";

const LAPTOP = { id: 3, label: "Gramps on my laptop", created_at: "2026-10-04T16:28:54", last_used_at: null };

describe("ApiKeysDialog", () => {
  beforeEach(() => {
    vi.mocked(listApiKeys).mockReset().mockResolvedValue([LAPTOP]);
    vi.mocked(createApiKey).mockReset();
    vi.mocked(deleteApiKey).mockReset().mockResolvedValue(undefined);
  });

  it("lists the user's keys", async () => {
    renderWithProviders(<ApiKeysDialog opened onClose={() => {}} />);
    expect(await screen.findByText("Gramps on my laptop")).toBeTruthy();
    expect(screen.getByText(/Last used: Never/)).toBeTruthy();
  });

  it("creates a named key and shows it once, in GRAMPS_WEB_API_KEY form", async () => {
    const user = userEvent.setup();
    vi.mocked(createApiKey).mockResolvedValue({ ...LAPTOP, id: 4, label: "Office PC", token: "SYNCTOKEN" });
    renderWithProviders(<ApiKeysDialog opened onClose={() => {}} />);
    await screen.findByText("Gramps on my laptop");
    await user.type(screen.getByLabelText("Name"), "Office PC");
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    expect(createApiKey).toHaveBeenCalledWith("tok", "Office PC");
    expect(await screen.findByText("SYNCTOKEN*encoded-url")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("SYNCTOKEN*encoded-url")).toBeNull();
  });

  it("removes a key after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApiKeysDialog opened onClose={() => {}} />);
    await screen.findByText("Gramps on my laptop");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(deleteApiKey).toHaveBeenCalledWith("tok", 3);
  });

  it("falls back to copying this session's key on a server without API keys", async () => {
    vi.mocked(listApiKeys).mockRejectedValue(new ApiKeysUnsupported());
    renderWithProviders(<ApiKeysDialog opened onClose={() => {}} />);
    expect(await screen.findByText(/needs Gramps Web API 3.23.0 or later/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy session key" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create API key" })).toBeNull();
  });
});
