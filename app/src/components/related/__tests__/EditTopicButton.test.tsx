// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import type { ObjectDetail } from "../../../store/objectDetail";

vi.mock("../../../auth/auth", () => ({
  getToken: vi.fn(async () => "tok"),
  hasPermissions: vi.fn(() => true),
}));
vi.mock("../../../store/topicsApi", async () => {
  const actual = await vi.importActual<typeof import("../../../store/topicsApi")>("../../../store/topicsApi");
  return { ...actual, updateTopic: vi.fn(async () => {}) };
});
vi.mock("../../../store/topicWindows", () => ({ bumpTopicActivity: vi.fn() }));

import { updateTopic } from "../../../store/topicsApi";
import { bumpTopicActivity } from "../../../store/topicWindows";
import { EditTopicButton } from "../EditTopicButton";

function topicDetail(title: string): ObjectDetail {
  return { handle: "N1", text: { string: JSON.stringify({ title }) } } as unknown as ObjectDetail;
}

// This is the exact regression the bug report ("if I edit a discussion
// title... the card is not updated") was about: RelatedPanel's own
// management page (where this button lives) and a discussion's
// FloatingTopicWindow are two independent component instances, and only
// bumpTopicActivity() -- not onSaved, which just refreshes this button's
// own mounting -- reaches the other one. A render test is what it takes to
// catch this class of bug at all: topicWindows.test.ts's own pure-function
// coverage can assert the counter increments, but not that a real UI
// action (click Edit, change the title, click Save) is actually wired to
// call it.
describe("EditTopicButton", () => {
  beforeEach(() => {
    vi.mocked(updateTopic).mockReset().mockResolvedValue(undefined);
    vi.mocked(bumpTopicActivity).mockReset();
  });

  it("saves the new title and bumps topicWindows.ts's shared activity counter, not just this panel's own onSaved", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(<EditTopicButton detail={topicDetail("Old title")} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const titleInput = await screen.findByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "New title");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(updateTopic).toHaveBeenCalledWith("tok", "N1", { title: "New title" }));
    expect(bumpTopicActivity).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("does not bump the activity counter (or call onSaved) when the save itself fails", async () => {
    vi.mocked(updateTopic).mockRejectedValueOnce(new Error("nope"));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(<EditTopicButton detail={topicDetail("Old title")} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    // Mantine's Modal mounts its body a tick after `opened` flips true (its
    // own internal Transition) -- findByRole (not getByRole) waits for that
    // rather than racing ahead of it, same reasoning the other test's own
    // findByLabelText("Title") has.
    await user.click(await screen.findByRole("button", { name: "Save" }));

    await screen.findByText("nope");
    expect(bumpTopicActivity).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("renders nothing for a user without EditObject", async () => {
    const { hasPermissions } = await import("../../../auth/auth");
    vi.mocked(hasPermissions).mockReturnValueOnce(false);

    renderWithProviders(<EditTopicButton detail={topicDetail("Old title")} onSaved={vi.fn()} />);

    // Not container.toBeEmptyDOMElement() -- MantineProvider itself renders
    // real <style> elements as DOM children of whatever it wraps (its
    // CSS-variables injection, not a <head> portal), so the container is
    // never truly empty regardless of what EditTopicButton itself renders;
    // asserting the absence of its own trigger button is what actually
    // tests this component's own eligibility gate.
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
