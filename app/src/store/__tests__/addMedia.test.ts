// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("../jobsApi", () => ({ uploadMediaFile: vi.fn() }));
const requeryDebounced = vi.fn();
vi.mock("../registry", () => ({ getViewStore: () => ({ requeryDebounced }) }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));

import { notifications } from "@mantine/notifications";
import { uploadMediaFile } from "../jobsApi";
import { openFilePicker, pickAndAddMedia, uploadMediaFiles } from "../addMedia";

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
