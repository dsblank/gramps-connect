// Thin wrapper around gramps-web-api's media archive endpoint
// (POST /api/media/archive/upload/zip) -- import_media_archive runs as the
// same kind of Celery task as import_file (see importApi.ts), so this
// mirrors that file's shape. Unlike a tree import, this endpoint doesn't
// attach *new* Media objects: MediaImporter (media_importer.py) only
// re-attaches files to Media objects that already exist in the tree but are
// missing their file, matched by checksum (or by relative path when the
// object's checksum is empty) -- effectively "restore files for records
// that reference them."
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

export interface MediaImportCounts {
  missing: number;
  uploaded: number;
  failures: number;
}

export type MediaImportPostResult =
  | { kind: "task"; task: { id: string } }
  | { kind: "counts"; counts: MediaImportCounts };

export interface MissingMediaObject {
  handle: string;
  gramps_id: string;
  /** The path/filename the tree expects to find this file at -- compare
   * against a zip's internal folder structure when files aren't matching
   * by checksum and might need to match by relative path instead (see
   * media_importer.py's _fix_missing_checksums). */
  path: string;
  checksum: string;
  desc: string;
}

// Display cap: a tree can have thousands of Media objects missing a file
// (e.g. a fresh import with no media uploaded yet), and this listing is a
// debugging aid in a modal, not a table -- neither an unbounded fetch nor
// rendering every row is worth it. base.py's list handler computes
// total_items (the X-Total-Count header) *before* slicing to page/pagesize,
// so requesting one capped page still tells the caller the true total.
export const MISSING_MEDIA_DISPLAY_LIMIT = 200;

export interface MissingMediaPage {
  items: MissingMediaObject[];
  total: number;
}

/** GET /api/media/?filemissing=true -- same filter_existing_files() check
 * MediaImporter itself runs, exposed as a plain list endpoint (base.py's
 * `filemissing` query arg) rather than anything added here. */
export async function listMissingMedia(token: string): Promise<MissingMediaPage> {
  const query = new URLSearchParams({
    filemissing: "true",
    page: "1",
    pagesize: String(MISSING_MEDIA_DISPLAY_LIMIT),
  });
  const res = await fetch(`${API_BASE}/api/media/?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const items = await res.json();
  const total = Number(res.headers.get("X-Total-Count") ?? items.length);
  return { items, total };
}

// Async broker: 202 with a task that resolves to the counts. Sync (no
// broker configured): the counts come back directly in the body, whatever
// the status code (201 per import_media.py's post(), though nothing here
// depends on that specific code).
export async function postMediaZip(token: string, file: File): Promise<MediaImportPostResult> {
  const res = await fetch(`${API_BASE}/api/media/archive/upload/zip`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: file,
  });
  if (res.status === 202) {
    const body = await res.json();
    return { kind: "task", task: body.task };
  }
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return { kind: "counts", counts: await res.json() };
}
