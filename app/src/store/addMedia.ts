// Creating new Media objects from local files -- shared by the global
// drop-anywhere handler (hooks/useMediaDrop.ts), MenuBar's "Add > Add
// media…", the Media list's own "Add media" button (AddButton.tsx), and a
// place's "Map overlays" section's "Upload map file" (MapOverlaysSection.tsx).
import { notifications } from "@mantine/notifications";
import { getToken } from "../auth/auth";
import { uploadMediaFile, uploadMediaFileDetailed } from "./jobsApi";
import { isMapFileMime } from "./mapFileMime";
import { attachRefListEntry } from "./refListApi";
import { getViewStore } from "./registry";
import { PLACE_VIEW } from "./views";
import { t } from "../i18n/i18n";

/** Uploads each file as a new Media object, one at a time, returning the
 * handles of those that succeeded. A failed file gets its own red toast and
 * doesn't stop the rest. */
export async function uploadMediaFiles(files: File[]): Promise<string[]> {
  const token = await getToken();
  const uploaded: string[] = [];
  for (const file of files) {
    try {
      uploaded.push(await uploadMediaFile(token, file));
    } catch (err: any) {
      notifications.show({ color: "red", title: "Media upload failed", message: err.message ?? String(err) });
    }
  }
  return uploaded;
}

/** "File"/"3 files" -- the start of every "... added" toast title. */
export function addedFilesLabel(count: number): string {
  return count > 1 ? `${count} files` : "File";
}

/** Uploads files as new, unattached Media -- the same result as dropping
 * them with nothing open or selected to attach them to. */
export async function addMediaFiles(files: File[]): Promise<void> {
  const uploaded = await uploadMediaFiles(files);
  if (uploaded.length === 0) return;
  getViewStore("media").requeryDebounced();
  notifications.show({ color: "green", title: `${addedFilesLabel(uploaded.length)} added`, message: t("Added to the Media list") });
}

/** Uploads map files and attaches each to a place's media_list, so it shows
 * in that place's "Map overlays" section. Returns how many were attached.
 * A file a server older than gramps-web-api v3.24.0 could only store as a
 * plain file (see jobsApi.ts's uploadMediaAsType) is still attached -- it's
 * the user's file either way -- but lands in the place's ordinary Media
 * section instead, so it gets a warning saying why. */
export async function addMapFilesToPlace(placeHandle: string, files: File[]): Promise<number> {
  const token = await getToken();
  let attached = 0;
  const plainFiles: string[] = [];
  for (const file of files) {
    try {
      const { handle, mime } = await uploadMediaFileDetailed(token, file);
      // Sequential: attachRefListEntry is a GET-then-PUT of the place, so
      // concurrent attaches would each overwrite the other's append.
      await attachRefListEntry(token, PLACE_VIEW, placeHandle, "media_list", { _class: "MediaRef", ref: handle });
      attached++;
      if (!isMapFileMime(mime)) plainFiles.push(file.name);
    } catch (err: any) {
      notifications.show({ color: "red", title: "Map file upload failed", message: `${file.name}: ${err.message ?? String(err)}` });
    }
  }
  if (attached === 0) return 0;
  getViewStore("media").requeryDebounced();
  if (plainFiles.length > 0) {
    notifications.show({
      color: "yellow",
      title: t("Saved as a plain file"),
      message: `${plainFiles.join(", ")}: ${t("this server doesn't recognize the file type (Gramps Web API 3.24 or later does), so it won't draw on the map.")}`,
      autoClose: false,
    });
  }
  if (attached > plainFiles.length) {
    notifications.show({
      color: "green",
      title: `${addedFilesLabel(attached - plainFiles.length)} added`,
      message: t("Attached to this place as map overlays"),
    });
  }
  return attached;
}

/** Opens the browser's file picker (several files allowed) and passes
 * whatever is chosen to `onFiles` -- not called at all if nothing is. Call
 * it straight from a click handler: browsers only open a picker in response
 * to a user gesture. The input is attached to the document while the
 * picker is open (as Mantine's FileButton does), since some embedded
 * webviews ignore a click on a detached one. `accept` is the input's own
 * attribute, e.g. mapFileMime.ts's MAP_FILE_ACCEPT. */
export function openFilePicker(onFiles: (files: File[]) => void, accept?: string): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (accept) input.accept = accept;
  input.style.display = "none";
  const cleanup = () => input.remove();
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    cleanup();
    if (files.length > 0) onFiles(files);
  });
  input.addEventListener("cancel", cleanup);
  document.body.appendChild(input);
  input.click();
}

/** The file picker, adding whatever is chosen via addMediaFiles. */
export function pickAndAddMedia(): void {
  openFilePicker((files) => void addMediaFiles(files));
}
