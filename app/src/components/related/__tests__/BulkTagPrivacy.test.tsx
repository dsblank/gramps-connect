// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "../../../testUtils/renderWithProviders";
import { VIEWS } from "../../../store/views";

const edit = vi.hoisted(() => ({ calls: [] as unknown[][], result: 3 as number | null, error: null as Error | null }));
vi.mock("../../../store/bulkEdit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/bulkEdit")>()),
  editSelected: async (...args: unknown[]) => {
    edit.calls.push(args);
    if (edit.error) throw edit.error;
    return edit.result;
  },
}));
vi.mock("../../../auth/auth", () => ({ getToken: async () => "tok", hasPermissions: () => true }));
const requery = vi.hoisted(() => vi.fn());
vi.mock("../../../store/registry", () => ({ getViewStore: () => ({ requeryDebounced: requery }) }));
vi.mock("../../../store/jobsApi", () => ({ getOrCreateTagHandle: async (_t: string, name: string) => `new-${name}` }));
vi.mock("../../RecordPicker", () => ({
  RecordPicker: ({ onPick, onCreateNew }: { onPick: (item: { handle: string }) => void; onCreateNew?: (name: string) => void }) => (
    <div>
      <button onClick={() => onPick({ handle: "T1" })}>pick T1</button>
      {onCreateNew && <button onClick={() => onCreateNew("Brick")}>create Brick</button>}
    </div>
  ),
}));
const shown = vi.hoisted(() => [] as string[]);
vi.mock("@mantine/notifications", async (importOriginal) => {
  const real = await importOriginal<typeof import("@mantine/notifications")>();
  return { ...real, notifications: { ...real.notifications, show: ({ message }: { message: string }) => shown.push(message) } };
});

import { BulkTagButton } from "../BulkTagButton";
import { BulkPrivacyButton } from "../BulkPrivacyButton";

const PEOPLE = VIEWS.find((v) => v.key === "person")!;
const TAGS = VIEWS.find((v) => v.key === "tag")!;
const HANDLES = ["A", "B", "C", "D"];

beforeEach(() => {
  edit.calls = [];
  edit.result = 3;
  edit.error = null;
  shown.length = 0;
  requery.mockReset();
});

describe("BulkTagButton", () => {
  it("adds a picked tag to every selected record in one call, saying how many already had it", async () => {
    renderWithProviders(<BulkTagButton view={PEOPLE} handles={HANDLES} />);
    fireEvent.click(screen.getByText("Tag"));
    fireEvent.click(await screen.findByText("pick T1"));
    await waitFor(() => expect(shown).toEqual(["Tagged 3 objects. 1 already were."]));
    expect(edit.calls).toHaveLength(1);
    expect(edit.calls[0].slice(0, 3)).toEqual([PEOPLE, HANDLES, [{ op: "add_tag", handle: "T1" }]]);
    expect(requery).toHaveBeenCalled();
  });

  it("creates a new tag by name when adding", async () => {
    renderWithProviders(<BulkTagButton view={PEOPLE} handles={HANDLES} />);
    fireEvent.click(screen.getByText("Tag"));
    fireEvent.click(await screen.findByText("create Brick"));
    await waitFor(() => expect(edit.calls[0][2]).toEqual([{ op: "add_tag", handle: "new-Brick" }]));
  });

  it("removes a tag, offering only existing ones", async () => {
    edit.result = 4;
    renderWithProviders(<BulkTagButton view={PEOPLE} handles={HANDLES} />);
    fireEvent.click(screen.getByText("Tag"));
    fireEvent.click(await screen.findByText("Remove tag"));
    expect(screen.queryByText("create Brick")).toBeNull();
    fireEvent.click(screen.getByText("pick T1"));
    await waitFor(() => expect(shown).toEqual(["Removed the tag from 4 objects."]));
    expect(edit.calls[0][2]).toEqual([{ op: "remove_tag", handle: "T1" }]);
  });

  it("shows the error and stays open when it fails", async () => {
    edit.error = new Error("Tag T1 does not exist");
    renderWithProviders(<BulkTagButton view={PEOPLE} handles={HANDLES} />);
    fireEvent.click(screen.getByText("Tag"));
    fireEvent.click(await screen.findByText("pick T1"));
    expect(await screen.findByText("Tag T1 does not exist")).toBeTruthy();
    expect(shown).toEqual([]);
  });

  it("isn't offered for Tags", () => {
    renderWithProviders(<BulkTagButton view={TAGS} handles={HANDLES} />);
    expect(screen.queryByText("Tag")).toBeNull();
  });
});

describe("BulkPrivacyButton", () => {
  it("makes every selected record private, or public, in one call", async () => {
    edit.result = 4;
    renderWithProviders(<BulkPrivacyButton view={PEOPLE} handles={HANDLES} />);
    fireEvent.click(screen.getByText("Privacy"));
    fireEvent.click(await screen.findByText("Make private"));
    await waitFor(() => expect(shown).toEqual(["Made 4 objects private."]));
    expect(edit.calls[0].slice(0, 3)).toEqual([PEOPLE, HANDLES, [{ op: "set_private", value: true }]]);

    edit.result = null;
    fireEvent.click(screen.getByText("Privacy"));
    fireEvent.click(await screen.findByText("Make public"));
    await waitFor(() => expect(shown[1]).toBe("Made 4 objects public."));
    expect(edit.calls[1][2]).toEqual([{ op: "set_private", value: false }]);
  });

  it("isn't offered for Tags", () => {
    renderWithProviders(<BulkPrivacyButton view={TAGS} handles={HANDLES} />);
    expect(screen.queryByText("Privacy")).toBeNull();
  });
});
