// Offering to shrink large images before they're uploaded as Media -- for
// the many uses that don't need full resolution (a map overlay, a photo on
// a story slide, a picture in a note), where a 16 MB scan only makes
// every view of it slower. Called by every "a person picked or dropped
// files to become new Media" entry point (addMedia.ts's uploadMediaFiles,
// RefPickerField.tsx's MediaListField, NoteEditor's image panel,
// StoryPhotosField) with the whole batch at once, so several large images
// get one question rather than one each. Generated files (reports,
// exports, gramplets, saved filters) never come through here.
//
// The dialog itself is LargeImageDialogHost.tsx, mounted once in App.tsx --
// the same module-state-plus-listener shape as confirmDialog.ts, plus a
// queue, since two upload paths can genuinely ask at once (a drop landing
// while a note's image upload is still waiting on its own answer).
//
// The resizing is browser-image-compression's: it downscales in a web
// worker, applies the photo's EXIF orientation to the pixels, and (for a
// JPEG) copies the rest of the EXIF block -- date taken, camera, GPS --
// across with the orientation tag removed, so nothing is rotated twice.
import imageCompression from "browser-image-compression";
// Bundled copy of the library for its worker to importScripts(); its own
// default is a jsdelivr URL, which the offline desktop build can't reach.
import imageCompressionLibUrl from "browser-image-compression/dist/browser-image-compression.js?url";
import { notifications } from "@mantine/notifications";
import { t } from "../i18n/i18n";

/** Either is enough to offer a resize. Picked so an ordinary phone photo
 * (12 MP: 4032 px, 2-5 MB) uploads without a question, while scans, maps
 * and camera RAW-sized exports get asked. */
export const LARGE_IMAGE_BYTES = 5 * 1024 * 1024;
export const LARGE_IMAGE_SIDE = 5000;

/** Longest-side targets offered, largest first. */
export const RESIZE_SIDES = [4000, 2500, 1600] as const;

/** JPEG quality for a resized image -- visually indistinguishable from the
 * original at screen sizes, roughly half the bytes of quality 1.0. */
const RESIZE_QUALITY = 0.9;

/** Types every browser can both decode and re-encode. Anything else (TIFF,
 * HEIC, GIF -- which may be animated, SVG) uploads as-is, unasked. */
const RESIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface LargeImage {
  file: File;
  width: number;
  height: number;
}

/** "original", a longest side in px, or null for Cancel (upload nothing). */
export type ResizeChoice = "original" | number;

export interface LargeImageRequest {
  images: LargeImage[];
  resolve: (choice: ResizeChoice | null) => void;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Width and height after shrinking to `side` on the longest edge -- never
 * enlarged, same as the library's own maxWidthOrHeight. */
export function scaledSize(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    // Default imageOrientation is "from-image", so a portrait photo stored
    // sideways with an EXIF rotation reports its upright size.
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null; // not decodable here (corrupt, or the browser lacks the codec)
  }
}

/** The images in `files` big enough to offer a resize for. */
export async function findLargeImages(files: File[]): Promise<LargeImage[]> {
  const large: LargeImage[] = [];
  for (const file of files) {
    if (!RESIZABLE_TYPES.has(file.type)) continue;
    const size = await imageDimensions(file);
    if (!size) continue;
    const longest = Math.max(size.width, size.height);
    // Heavy but already small in pixels (an uncompressed PNG, say): no
    // offered size would shrink it, so there's nothing to ask.
    if (longest <= RESIZE_SIDES[RESIZE_SIDES.length - 1]) continue;
    if (file.size > LARGE_IMAGE_BYTES || longest > LARGE_IMAGE_SIDE) {
      large.push({ file, ...size });
    }
  }
  return large;
}

// --- The dialog request, queued -------------------------------------------

let pending: LargeImageRequest | null = null;
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeLargeImageDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLargeImageRequest(): LargeImageRequest | null {
  return pending;
}

export function resolveLargeImageDialog(choice: ResizeChoice | null): void {
  pending?.resolve(choice);
  pending = null;
  notify();
}

/** Shows LargeImageDialogHost for `images`, after any dialog already
 * showing has been answered. */
export function askAboutLargeImages(images: LargeImage[]): Promise<ResizeChoice | null> {
  const answer = queue.then(
    () =>
      new Promise<ResizeChoice | null>((resolve) => {
        pending = { images, resolve };
        notify();
      }),
  );
  queue = answer;
  return answer;
}

// --- Remembered choice -----------------------------------------------------

const STORAGE_KEY = "gramps-connect.largeImageChoice";

/** The last answer given, to preselect next time -- a per-browser
 * convenience, so a missing/blocked localStorage just means "original". */
export function getRememberedResizeChoice(): ResizeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const side = Number(raw);
    if (raw && (RESIZE_SIDES as readonly number[]).includes(side)) return side;
  } catch {
    // ignore
  }
  return "original";
}

export function rememberResizeChoice(choice: ResizeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(choice));
  } catch {
    // ignore
  }
}

// --- Resizing --------------------------------------------------------------

/** A copy of `file` no larger than `side` px on its longest edge, in the
 * same format (a PNG keeps its transparency -- map overlays rely on it). */
export async function resizeImage(file: File, side: number): Promise<File> {
  const resized = await imageCompression(file, {
    maxWidthOrHeight: side,
    initialQuality: RESIZE_QUALITY,
    preserveExif: true,
    useWebWorker: true,
    libURL: new URL(imageCompressionLibUrl, window.location.href).href,
  });
  // The library hands back a Blob-ish File; make sure name and type match
  // the original so the upload's MIME and Media description are unchanged.
  return new File([resized], file.name, { type: file.type, lastModified: file.lastModified });
}

/** The files to actually upload: `files` unchanged when none is a large
 * image; otherwise asks once for the whole batch and returns the batch with
 * the large images swapped for resized copies (or untouched, for "Keep
 * original"). Null when the person cancels -- upload nothing. A resize that
 * fails falls back to that file's original, with a red toast. */
export async function prepareImageUploads(files: File[]): Promise<File[] | null> {
  const large = await findLargeImages(files);
  if (large.length === 0) return files;
  const choice = await askAboutLargeImages(large);
  if (choice === null) return null;
  rememberResizeChoice(choice);
  if (choice === "original") return files;

  const id = `resize-images-${Date.now()}`;
  notifications.show({
    id,
    loading: true,
    autoClose: false,
    withCloseButton: false,
    title: large.length > 1 ? t("Resizing images…") : t("Resizing image…"),
    message: large.map((l) => l.file.name).join(", "),
  });
  const replacements = new Map<File, File>();
  let before = 0;
  let after = 0;
  for (const { file } of large) {
    try {
      const resized = await resizeImage(file, choice);
      // A re-encode can come out bigger than an already well-compressed
      // original only barely over the size limit -- keep the smaller.
      const kept = resized.size < file.size ? resized : file;
      replacements.set(file, kept);
      before += file.size;
      after += kept.size;
    } catch (err: any) {
      notifications.show({
        color: "red",
        title: t("Couldn't resize image"),
        message: `${file.name}: ${err?.message ?? String(err)} — ${t("uploading the original instead")}`,
      });
    }
  }
  if (replacements.size > 0) {
    notifications.update({
      id,
      loading: false,
      autoClose: 4000,
      withCloseButton: true,
      color: "green",
      title: replacements.size > 1 ? t("Images resized") : t("Image resized"),
      message: `${formatFileSize(before)} → ${formatFileSize(after)}`,
    });
  } else {
    notifications.hide(id);
  }
  return files.map((f) => replacements.get(f) ?? f);
}
