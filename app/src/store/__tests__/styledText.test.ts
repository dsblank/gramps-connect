import { describe, expect, it } from "vitest";
import {
  IMAGE_PLACEHOLDER, cssColor, docToStyledText, mediaLink, sameStyledText, styledTextToDoc, type StyledText,
} from "../styledText";

function roundTrip(text: StyledText): StyledText {
  return docToStyledText(styledTextToDoc(text));
}

describe("styledText", () => {
  it("round-trips plain text with blank and trailing lines", () => {
    const text = { string: "Line one\n\nLine three\n" };
    const doc = styledTextToDoc(text);
    expect(doc.content).toHaveLength(4);
    expect(roundTrip(text).string).toBe(text.string);
    expect(roundTrip(text).tags).toEqual([]);
  });

  it("round-trips the empty note", () => {
    expect(roundTrip({ string: "" }).string).toBe("");
  });

  it("round-trips overlapping and multi-line tags", () => {
    const text: StyledText = {
      string: "Born in Berlin\nand died in Paris",
      tags: [
        { name: "bold", value: null, ranges: [[0, 4], [20, 24]] },
        { name: "italic", value: null, ranges: [[2, 18]] },
        { name: "fontcolor", value: "#FF0000", ranges: [[8, 14]] },
        { name: "fontsize", value: 14, ranges: [[0, 30]] },
        { name: "link", value: "gramps://Place/handle/ABC", ranges: [[27, 32]] },
      ],
    };
    expect(sameStyledText(roundTrip(text), text)).toBe(true);
  });

  it("counts code points, not UTF-16 units", () => {
    // "👪" is two UTF-16 units but one Python character.
    const text: StyledText = { string: "👪 Family", tags: [{ name: "bold", value: null, ranges: [[2, 8]] }] };
    const doc = styledTextToDoc(text);
    const para = doc.content![0].content!;
    expect(para[0].text).toBe("👪 ");
    expect(para[1].text).toBe("Family");
    expect(para[1].marks).toEqual([{ type: "bold" }]);
    expect(sameStyledText(roundTrip(text), text)).toBe(true);
  });

  it("turns a media-linked placeholder into an inline image and back", () => {
    const text: StyledText = {
      string: `Photo: ${IMAGE_PLACEHOLDER} done`,
      tags: [{ name: "link", value: mediaLink("M1"), ranges: [[7, 8]] }],
    };
    const para = styledTextToDoc(text).content![0].content!;
    expect(para[1]).toEqual({ type: "grampsImage", attrs: { handle: "M1", link: mediaLink("M1") } });
    expect(sameStyledText(roundTrip(text), text)).toBe(true);
  });

  it("keeps an unknown tag type with its text", () => {
    const text: StyledText = { string: "abc", tags: [{ name: "futuretag", value: "x", ranges: [[1, 2]] }] };
    expect(sameStyledText(roundTrip(text), text)).toBe(true);
  });

  it("merges touching ranges of the same tag", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "text", text: "ab", marks: [{ type: "bold" }] },
        { type: "text", text: "cd", marks: [{ type: "bold" }, { type: "italic" }] },
      ] }],
    };
    const out = docToStyledText(doc);
    expect(out.tags!.find((t) => t.name === "bold")!.ranges).toEqual([[0, 4]]);
    expect(out.tags!.find((t) => t.name === "italic")!.ranges).toEqual([[2, 4]]);
  });

  it("normalizes GTK 16-bit colors for display only", () => {
    expect(cssColor("#ffff00000000")).toBe("#ff0000");
    expect(cssColor("#00FF00")).toBe("#00FF00");
    expect(cssColor("red; background:url(x)")).toBeUndefined();
  });
});
