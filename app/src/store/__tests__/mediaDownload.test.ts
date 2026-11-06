import { describe, expect, it } from "vitest";
import { mediaDownloadName } from "../mediaDownload";
import { FILE_NAME_ATTRIBUTE } from "../jobsApi";

describe("mediaDownloadName", () => {
  it("prefers a generated item's recorded file name", () => {
    expect(
      mediaDownloadName({
        handle: "H1",
        path: "abc123.ged",
        attribute_list: [{ type: "Other" , value: "x" }, { type: FILE_NAME_ATTRIBUTE, value: "Smith family.ged" }],
      })
    ).toBe("Smith family.ged");
  });

  it("falls back to the last segment of the stored path", () => {
    expect(mediaDownloadName({ handle: "H1", path: "photos/1890/wedding.jpg" })).toBe("wedding.jpg");
    expect(mediaDownloadName({ handle: "H1", path: "C:\\scans\\deed.pdf" })).toBe("deed.pdf");
    expect(mediaDownloadName({ handle: "H1", path: "letter.txt", attribute_list: [] })).toBe("letter.txt");
  });

  it("falls back to the handle when there's no usable name", () => {
    expect(mediaDownloadName({ handle: "H1" })).toBe("H1");
    expect(mediaDownloadName({ handle: "H1", path: "dir/" , attribute_list: [{ type: FILE_NAME_ATTRIBUTE, value: "  " }] })).toBe("dir");
    expect(mediaDownloadName({ handle: "H1", path: "" })).toBe("H1");
  });
});
