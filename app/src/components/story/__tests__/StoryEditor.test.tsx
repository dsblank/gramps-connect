// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import type { StorySpec } from "../../../store/storyBuilder";

const i18n = vi.hoisted(() => ({ lang: "en" }));
vi.mock("../../../i18n/i18n", () => ({
  getI18nSnapshot: () => ({ lang: i18n.lang, strings: {} }),
  subscribe: () => () => {},
  t: (s: string) => s,
}));
// The player and the tree aren't what's tested here: the preview records
// the spec it was last given, and no slide refers to anything in the tree.
const previewed = vi.hoisted(() => ({ spec: null as StorySpec | null }));
vi.mock("../../StoryView", () => ({
  StoryPreview: ({ spec }: { spec: StorySpec }) => {
    previewed.spec = spec;
    return null;
  },
  StoryView: () => null,
}));
vi.mock("../../../auth/auth", () => ({ getToken: async () => "token" }));

import { StoryEditor } from "../StoryEditor";

const SPEC: StorySpec = { title: "Josef", points: [{ title: "Josef", text: "Opening." }, { title: "Birth" }] };

let changes: StorySpec[] = [];
const last = () => changes[changes.length - 1];

function renderEditor(spec: StorySpec = SPEC) {
  renderWithProviders(<StoryEditor spec={spec} onChange={(s) => changes.push(s)} previewStackId="stack" />);
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Title, language and map"));
}

const languageInput = () => screen.getByLabelText("Language") as HTMLInputElement;
const mapInput = () => screen.getByRole("textbox", { name: "Map" }) as HTMLInputElement;

async function pickMap(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(mapInput());
  // Mantine's dropdown is still mid-transition, so "hidden" to a role query.
  await user.click(await screen.findByRole("option", { name: label, hidden: true }));
}

describe("StoryEditor's story settings", () => {
  beforeEach(() => {
    i18n.lang = "en";
    // jsdom has no layout; Mantine's Select scrolls to the picked option.
    Element.prototype.scrollIntoView ??= () => {};
    changes = [];
    previewed.spec = null;
  });

  it("shows a story without settings as having none", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openSettings(user);
    expect(languageInput().value).toBe("");
    expect(mapInput().value).toBe("Viewer's choice");
  });

  it("shows the settings a story already has", async () => {
    const user = userEvent.setup();
    renderEditor({ ...SPEC, language: "de", basemap: "historical" });
    await openSettings(user);
    expect(languageInput().value).toBe("de");
    expect(mapInput().value).toBe("Historical maps for each slide's year");
  });

  it("stores the language trimmed, and removes it when emptied", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openSettings(user);
    await user.type(languageInput(), " fr_CA");
    expect(last().language).toBe("fr_CA");
    expect(previewed.spec?.language).toBe("fr_CA");
    await user.clear(languageInput());
    expect("language" in last()).toBe(false);
    // The slides are left alone.
    expect(last().points).toEqual(SPEC.points);
  });

  it("flags a language that isn't a language code", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openSettings(user);
    await user.type(languageInput(), "German!");
    expect(screen.getByText("Not a language code, so it's left out.")).toBeTruthy();
    await user.clear(languageInput());
    await user.type(languageInput(), "de-AT");
    expect(screen.queryByText("Not a language code, so it's left out.")).toBeNull();
  });

  it("stores each map choice, with the viewer's choice as unset", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openSettings(user);
    await pickMap(user, "No map");
    expect(last().basemap).toBe("none");
    expect(previewed.spec?.basemap).toBe("none");
    await pickMap(user, "Today's map");
    expect(last().basemap).toBe("standard");
    await pickMap(user, "Historical maps for each slide's year");
    expect(last().basemap).toBe("historical");
    await pickMap(user, "Viewer's choice");
    expect("basemap" in last()).toBe(false);
  });

  it("undoes and redoes a setting", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openSettings(user);
    await pickMap(user, "No map");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect("basemap" in last()).toBe(false);
    expect(mapInput().value).toBe("Viewer's choice");
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(last().basemap).toBe("none");
    expect(mapInput().value).toBe("No map");
  });

  it("makes one undo step of typing a language", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openSettings(user);
    await user.type(languageInput(), "de");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(languageInput().value).toBe("");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("keeps the settings while slides are edited", async () => {
    const user = userEvent.setup();
    renderEditor({ ...SPEC, language: "de", basemap: "none" });
    await user.click(screen.getByRole("button", { name: "+ Add slide" }));
    expect(last().points).toHaveLength(3);
    expect(last()).toMatchObject({ language: "de", basemap: "none" });
  });
});

describe("StoryEditor in another language", () => {
  beforeEach(() => {
    changes = [];
    Element.prototype.scrollIntoView ??= () => {};
  });

  it("is in the app's language where the story package has it", async () => {
    i18n.lang = "de";
    const user = userEvent.setup();
    renderEditor();
    expect(screen.getByRole("button", { name: "+ Folie hinzufügen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rückgängig" })).toBeTruthy();
    await user.click(screen.getByText("Titel, Sprache und Karte"));
    expect((screen.getByRole("textbox", { name: "Karte" }) as HTMLInputElement).value).toBe("Wahl des Betrachters");
    await user.type(screen.getByLabelText("Sprache"), "x!");
    expect(screen.getByText("Kein Sprachcode, daher wird er weggelassen.")).toBeTruthy();
  });
});
