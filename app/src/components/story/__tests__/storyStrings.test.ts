import { describe, expect, it, vi } from "vitest";

// The app's own translations: only "Close" has one, as if from Gramps.
vi.mock("../../../i18n/i18n", () => ({
  getI18nSnapshot: () => ({ lang: "ja", strings: {} }),
  t: (s: string) => (s === "Close" ? "閉じる" : s),
}));

import { EDITOR_ENGLISH } from "@gramps-connect/story/editor";
import { storyWords } from "../storyStrings";

describe("storyWords", () => {
  it("uses the story package's words where it has the app's language", () => {
    const de = storyWords("de_AT");
    expect(de.editor.addSlide).toBe("Folie hinzufügen");
    expect(de.mapEditor.polygon).toBe("Polygon");
    expect(de.mapEditor.lockedMany(2)).toBe("2 Formen können hier nicht bearbeitet werden");
    expect(de.player.next).toBe("Weiter");
    expect(de.player.auto).toBe("Automatisch");
    expect(storyWords("fr").editor.undo).toBe("Annuler");
  });

  it("has the app-only words in each of those languages", () => {
    for (const lang of ["de", "es", "fr", "nl"]) {
      const { say } = storyWords(lang);
      for (const english of ["Event", "Upload photo", "Select existing…", "Not a language code, so it's left out."]) {
        expect(say(english), `${lang}: ${english}`).not.toBe(english);
      }
    }
  });

  it("falls back to the app's t() in other languages", () => {
    const ja = storyWords("ja");
    expect(ja.editor.addSlide).toBe("Add slide");
    expect(ja.player).toEqual({ previous: "Previous", next: "Next", close: "閉じる" });
    expect(ja.say("Event")).toBe("Event");
    expect(ja.mapEditor.lockedMany(3)).toBe("3 shapes can't be edited here");
    // The current language by default.
    expect(storyWords().editor).toEqual(ja.editor);
  });

  it("stays English in English", () => {
    expect(storyWords("en").editor).toBe(EDITOR_ENGLISH);
    expect(storyWords("en_GB").player.next).toBe("Next");
  });
});
