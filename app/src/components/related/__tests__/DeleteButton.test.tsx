// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import type { ObjectDetail } from "../../../store/objectDetail";
import { NOTE_VIEW, TOPICS_VIEW } from "../../../store/views";

vi.mock("../../../auth/auth", () => ({
  getToken: vi.fn(async () => "tok"),
  hasPermissions: vi.fn(() => true),
}));
vi.mock("../../../store/objectsApi", () => ({ deleteObject: vi.fn(async () => {}) }));
vi.mock("../../../store/topicsApi", () => ({ deleteAllTopicMessages: vi.fn(async () => {}) }));
vi.mock("../../../store/topicWindows", () => ({ closeTopicWindow: vi.fn() }));
vi.mock("../../../store/registry", () => ({ getViewStore: vi.fn(() => ({ requeryDebounced: vi.fn() })) }));
vi.mock("../../../store/placeReconnect", () => ({ reconnectPlaceChildren: vi.fn(async () => {}) }));

import { deleteObject } from "../../../store/objectsApi";
import { deleteAllTopicMessages } from "../../../store/topicsApi";
import { closeTopicWindow } from "../../../store/topicWindows";
import { DeleteButton } from "../DeleteButton";

function detailFor(title: string): ObjectDetail {
  return { handle: "N1", text: { string: JSON.stringify({ title }) } } as unknown as ObjectDetail;
}

// The exact regression: DeleteButton's own confirm dialog and a
// discussion's FloatingTopicWindow are two independent component
// instances -- deleting the note server-side doesn't make an already-open
// window go away on its own (confirmed live: it stayed open, showing a
// record that no longer existed), so DeleteButton has to explicitly close
// it via topicWindows.ts's closeTopicWindow.
describe("DeleteButton", () => {
  beforeEach(() => {
    vi.mocked(deleteObject).mockReset().mockResolvedValue(undefined);
    vi.mocked(deleteAllTopicMessages).mockReset().mockResolvedValue(undefined);
    vi.mocked(closeTopicWindow).mockReset();
  });

  it("deletes every message, then the discussion note, then closes its own floating window", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeleteButton view={TOPICS_VIEW} detail={detailFor("Smith family origins")} />);

    await user.click(screen.getByRole("button", { name: "Delete this discussion" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await vi.waitFor(() => expect(deleteObject).toHaveBeenCalledWith("tok", TOPICS_VIEW, "N1"));
    expect(deleteAllTopicMessages).toHaveBeenCalledWith("tok", "N1");
    expect(closeTopicWindow).toHaveBeenCalledWith("N1");
    // Messages are cleared out before the discussion note itself is, not
    // after -- once it's gone, nothing could find them to delete them by.
    expect(vi.mocked(deleteAllTopicMessages).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deleteObject).mock.invocationCallOrder[0]);
  });

  it("never touches topic-message cleanup or any floating window for a non-discussion delete", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeleteButton view={NOTE_VIEW} detail={detailFor("A plain note")} />);

    await user.click(screen.getByRole("button", { name: "Delete this note" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await vi.waitFor(() => expect(deleteObject).toHaveBeenCalledWith("tok", NOTE_VIEW, "N1"));
    expect(deleteAllTopicMessages).not.toHaveBeenCalled();
    expect(closeTopicWindow).not.toHaveBeenCalled();
  });
});
