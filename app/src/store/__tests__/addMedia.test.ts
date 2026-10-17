// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("../jobsApi", () => ({ uploadMediaFile: vi.fn(), uploadMediaFileDetailed: vi.fn() }));
vi.mock("../refListApi", () => ({ attachRefListEntry: vi.fn() }));
vi.mock("../views", () => ({ PLACE_VIEW: { key: "place" } }));
const requeryDebounced = vi.fn();
vi.mock("../registry", () => ({ getViewStore: () => ({ requeryDebounced }) }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));

import { notifications } from "@mantine/notifications";
import { uploadMediaFile, uploadMediaFileDetailed } from "../jobsApi";
import { attachRefListEntry } from "../refListApi";
import { addMapFilesToPlace, openFilePicker, pickAndAddMedia, uploadMediaFiles } from "../addMedia";

function pickerInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input in the document");
  return input;
}

function choose(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files });
  input.dispatchEvent(new Event("change"));
}

describe("pickAndAddMedia", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(uploadMediaFile).mockReset();
    vi.mocked(notifications.show).mockReset();
    requeryDebounced.mockReset();
  });

  it("opens a multi-file picker and uploads what's chosen as new Media", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    vi.mocked(uploadMediaFile).mockResolvedValueOnce("m1").mockResolvedValueOnce("m2");
    pickAndAddMedia();
    const input = pickerInput();
    expect(input.multiple).toBe(true);
    expect(click).toHaveBeenCalled();

    const files = [new File(["a"], "a.gpx"), new File(["b"], "b.jpg")];
    choose(input, files);
    await vi.waitFor(() => expect(requeryDebounced).toHaveBeenCalled());
    expect(vi.mocked(uploadMediaFile).mock.calls.map(([, f]) => f)).toEqual(files);
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "green", title: "2 files added" }));
    // The input is gone once the picker has been answered.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    click.mockRestore();
  });

  it("removes the input when the picker is cancelled, uploading nothing", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    pickAndAddMedia();
    pickerInput().dispatchEvent(new Event("cancel"));
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(uploadMediaFile).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

describe("uploadMediaFiles", () => {
  it("keeps going past a failed file, toasting it", async () => {
    vi.mocked(uploadMediaFile).mockReset()
      .mockRejectedValueOnce(new Error("quota exceeded"))
      .mockResolvedValueOnce("m2");
    vi.mocked(notifications.show).mockReset();
    expect(await uploadMediaFiles([new File(["a"], "a.jpg"), new File(["b"], "b.jpg")])).toEqual(["m2"]);
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "red", message: "quota exceeded" }));
  });
});

describe("openFilePicker", () => {
  it("sets accept on the input", () => {
    document.body.innerHTML = "";
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    openFilePicker(() => {}, ".kml,.geojson,.gpx");
    expect(pickerInput().accept).toBe(".kml,.geojson,.gpx");
    click.mockRestore();
  });
});

describe("addMapFilesToPlace", () => {
  beforeEach(() => {
    vi.mocked(uploadMediaFileDetailed).mockReset();
    vi.mocked(attachRefListEntry).mockReset().mockResolvedValue(undefined as any);
    vi.mocked(notifications.show).mockReset();
  });

  it("attaches each uploaded file to the place, in order", async () => {
    vi.mocked(uploadMediaFileDetailed)
      .mockResolvedValueOnce({ handle: "m1", mime: "application/gpx+xml" })
      .mockResolvedValueOnce({ handle: "m2", mime: "application/geo+json" });
    expect(await addMapFilesToPlace("p1", [new File(["a"], "a.gpx"), new File(["b"], "b.geojson")])).toBe(2);
    expect(vi.mocked(attachRefListEntry).mock.calls.map((c) => [c[2], c[4]])).toEqual([
      ["p1", { _class: "MediaRef", ref: "m1" }],
      ["p1", { _class: "MediaRef", ref: "m2" }],
    ]);
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "green", title: "2 files added" }));
  });

  it("still attaches a file an older server stored as a plain file, with a warning", async () => {
    vi.mocked(uploadMediaFileDetailed).mockResolvedValueOnce({ handle: "m1", mime: "application/octet-stream" });
    expect(await addMapFilesToPlace("p1", [new File(["a"], "walk.gpx")])).toBe(1);
    expect(attachRefListEntry).toHaveBeenCalledTimes(1);
    const shown = vi.mocked(notifications.show).mock.calls.map(([n]) => n);
    expect(shown).toEqual([expect.objectContaining({ color: "yellow", message: expect.stringContaining("walk.gpx") })]);
  });

  it("reports a failed upload and attaches nothing for it", async () => {
    vi.mocked(uploadMediaFileDetailed).mockRejectedValueOnce(new Error("quota exceeded"));
    expect(await addMapFilesToPlace("p1", [new File(["a"], "a.gpx")])).toBe(0);
    expect(attachRefListEntry).not.toHaveBeenCalled();
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "red", message: "a.gpx: quota exceeded" }));
  });
});
