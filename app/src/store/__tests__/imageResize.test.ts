// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("browser-image-compression", () => ({ default: vi.fn() }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn(), update: vi.fn(), hide: vi.fn() } }));

import imageCompression from "browser-image-compression";
import { notifications } from "@mantine/notifications";
import {
  findLargeImages,
  getLargeImageRequest,
  getRememberedResizeChoice,
  prepareImageUploads,
  resolveLargeImageDialog,
  scaledSize,
} from "../imageResize";

const MB = 1024 * 1024;

/** A File whose .size is `bytes` without allocating it. */
function fakeFile(name: string, type: string, bytes: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

/** createImageBitmap stub: dimensions per file name. */
function stubDimensions(dims: Record<string, [number, number]>) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (file: File) => {
      const d = dims[file.name];
      if (!d) throw new Error("undecodable");
      return { width: d[0], height: d[1], close: () => {} };
    }),
  );
}

/** Answers the dialog as soon as it's raised. */
async function answerWhenAsked(choice: "original" | number | null) {
  await vi.waitFor(() => expect(getLargeImageRequest()).not.toBeNull());
  resolveLargeImageDialog(choice);
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(imageCompression).mockReset();
  vi.mocked(notifications.show).mockReset();
  vi.mocked(notifications.update).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scaledSize", () => {
  it("shrinks the longest side to the target, keeping aspect", () => {
    expect(scaledSize(7200, 5400, 4000)).toEqual({ width: 4000, height: 3000 });
    expect(scaledSize(3000, 6000, 1600)).toEqual({ width: 800, height: 1600 });
  });
  it("never enlarges", () => {
    expect(scaledSize(1000, 800, 4000)).toEqual({ width: 1000, height: 800 });
  });
});

describe("findLargeImages", () => {
  it("flags heavy or very wide images, skips phone photos, non-images and undecodable files", async () => {
    stubDimensions({
      "map.jpg": [7200, 5400], // heavy and wide
      "wide.png": [6000, 1000], // light but wide
      "phone.jpg": [4032, 3024], // ordinary
      "tiny-heavy.png": [1200, 900], // heavy, but no offered size shrinks it
    });
    const files = [
      fakeFile("map.jpg", "image/jpeg", 16 * MB),
      fakeFile("wide.png", "image/png", 1 * MB),
      fakeFile("phone.jpg", "image/jpeg", 3 * MB),
      fakeFile("tiny-heavy.png", "image/png", 8 * MB),
      fakeFile("scan.tif", "image/tiff", 40 * MB),
      fakeFile("broken.jpg", "image/jpeg", 9 * MB),
    ];
    const large = await findLargeImages(files);
    expect(large.map((l) => [l.file.name, l.width, l.height])).toEqual([
      ["map.jpg", 7200, 5400],
      ["wide.png", 6000, 1000],
    ]);
  });
});

describe("prepareImageUploads", () => {
  it("returns the batch untouched, without asking, when nothing is large", async () => {
    stubDimensions({ "phone.jpg": [4032, 3024] });
    const files = [fakeFile("phone.jpg", "image/jpeg", 3 * MB), fakeFile("notes.txt", "text/plain", 10)];
    expect(await prepareImageUploads(files)).toBe(files);
    expect(getLargeImageRequest()).toBeNull();
  });

  it("asks once for the whole batch and returns null on Cancel", async () => {
    stubDimensions({ "a.jpg": [7000, 5000], "b.jpg": [8000, 6000] });
    const files = [fakeFile("a.jpg", "image/jpeg", 12 * MB), fakeFile("b.jpg", "image/jpeg", 14 * MB)];
    const result = prepareImageUploads(files);
    await vi.waitFor(() => expect(getLargeImageRequest()?.images).toHaveLength(2));
    resolveLargeImageDialog(null);
    expect(await result).toBeNull();
    expect(imageCompression).not.toHaveBeenCalled();
  });

  it("keeps originals on 'Keep original' and remembers it", async () => {
    stubDimensions({ "a.jpg": [7000, 5000] });
    const files = [fakeFile("a.jpg", "image/jpeg", 12 * MB)];
    const result = prepareImageUploads(files);
    await answerWhenAsked("original");
    expect(await result).toEqual(files);
    expect(getRememberedResizeChoice()).toBe("original");
  });

  it("swaps large images for resized copies with the same name and type, leaving the rest", async () => {
    stubDimensions({ "map.png": [7200, 5400], "phone.jpg": [4032, 3024] });
    vi.mocked(imageCompression).mockResolvedValue(new Blob(["small"], { type: "image/png" }) as File);
    const map = fakeFile("map.png", "image/png", 16 * MB);
    const phone = fakeFile("phone.jpg", "image/jpeg", 3 * MB);
    const result = prepareImageUploads([map, phone]);
    await answerWhenAsked(2500);
    const out = (await result)!;
    expect(out[1]).toBe(phone);
    expect(out[0]).not.toBe(map);
    expect(out[0].name).toBe("map.png");
    expect(out[0].type).toBe("image/png");
    expect(vi.mocked(imageCompression).mock.calls[0][1]).toMatchObject({ maxWidthOrHeight: 2500, preserveExif: true });
    expect(getRememberedResizeChoice()).toBe(2500);
  });

  it("falls back to the original, with a red toast, when a resize fails", async () => {
    stubDimensions({ "a.jpg": [7000, 5000] });
    vi.mocked(imageCompression).mockRejectedValue(new Error("boom"));
    const files = [fakeFile("a.jpg", "image/jpeg", 12 * MB)];
    const result = prepareImageUploads(files);
    await answerWhenAsked(4000);
    expect(await result).toEqual(files);
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "red" }));
  });

  it("queues a second batch's question until the first is answered", async () => {
    stubDimensions({ "a.jpg": [7000, 5000], "b.jpg": [7000, 5000] });
    const first = prepareImageUploads([fakeFile("a.jpg", "image/jpeg", 12 * MB)]);
    const second = prepareImageUploads([fakeFile("b.jpg", "image/jpeg", 12 * MB)]);
    await vi.waitFor(() => expect(getLargeImageRequest()?.images[0].file.name).toBe("a.jpg"));
    resolveLargeImageDialog("original");
    await vi.waitFor(() => expect(getLargeImageRequest()?.images[0].file.name).toBe("b.jpg"));
    resolveLargeImageDialog(null);
    expect(await first).toHaveLength(1);
    expect(await second).toBeNull();
  });
});
