// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { noteExtensions } from "../noteExtensions";
import {
  IMAGE_PLACEHOLDER, docToStyledText, mediaLink, sameStyledText, styledTextToDoc, type StyledText,
} from "../../../store/styledText";

const SAMPLE: StyledText = {
  string: `Born in Berlin\nSee ${IMAGE_PLACEHOLDER} and https://example.org\n\nx2 H2O`,
  tags: [
    { name: "bold", value: null, ranges: [[0, 4]] },
    { name: "italic", value: null, ranges: [[2, 14]] },
    { name: "underline", value: null, ranges: [[8, 14]] },
    { name: "strikethrough", value: null, ranges: [[8, 10]] },
    { name: "fontcolor", value: "#ffff00000000", ranges: [[15, 18]] },
    { name: "highlight", value: "#FFFF00", ranges: [[19, 20]] },
    { name: "fontface", value: "Serif", ranges: [[0, 4]] },
    { name: "fontsize", value: 14, ranges: [[0, 4]] },
    { name: "link", value: mediaLink("M1"), ranges: [[19, 20]] },
    { name: "link", value: "https://example.org", ranges: [[25, 44]] },
    { name: "link", value: "gramps://Person/handle/P1", ranges: [[8, 14]] },
    { name: "superscript", value: null, ranges: [[47, 48]] },
    { name: "subscript", value: null, ranges: [[50, 51]] },
  ],
};

function editorFor(text: StyledText): Editor {
  return new Editor({ extensions: noteExtensions(), content: styledTextToDoc(text) });
}

describe("note editor schema", () => {
  it("accepts every converted tag and gives the same StyledText back", () => {
    const editor = editorFor(SAMPLE);
    editor.state.doc.check();
    expect(sameStyledText(docToStyledText(editor.getJSON()), SAMPLE)).toBe(true);
    editor.destroy();
  });

  it("keeps formatting on the right characters after an edit", () => {
    const editor = editorFor({ string: "Born in Berlin", tags: [{ name: "bold", value: null, ranges: [[8, 14]] }] });
    editor.commands.insertContentAt(1, "Anna, ");
    const out = docToStyledText(editor.getJSON());
    expect(out.string).toBe("Anna, Born in Berlin");
    expect(out.tags).toEqual([{ _class: "StyledTextTag", name: "bold", value: null, ranges: [[14, 20]] }]);
    editor.destroy();
  });

  it("adds a highlight and an inline image as gramps-web stores them", () => {
    const editor = editorFor({ string: "ab" });
    editor.chain().setTextSelection({ from: 1, to: 2 }).setMark("highlight", { value: "#FFFF00" }).run();
    editor.chain().setTextSelection(3).insertGrampsImage("M9").run();
    const out = docToStyledText(editor.getJSON());
    expect(out.string).toBe(`ab${IMAGE_PLACEHOLDER}`);
    expect(out.tags).toContainEqual({ _class: "StyledTextTag", name: "highlight", value: "#FFFF00", ranges: [[0, 1]] });
    expect(out.tags).toContainEqual({ _class: "StyledTextTag", name: "link", value: mediaLink("M9"), ranges: [[2, 3]] });
    editor.destroy();
  });

  it("leaves born-in star marks alone", () => {
    const editor = editorFor({ string: "" });
    // Typed input rules only run through the view; check the regex we kept
    // is the underscore one, not the star one.
    const italic = editor.extensionManager.extensions.find((e) => e.name === "italic")!;
    expect(String(italic.config.addInputRules)).toContain("underscore");
    editor.destroy();
  });
});
