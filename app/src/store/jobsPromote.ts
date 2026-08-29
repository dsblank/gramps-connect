// Client-side promotion of a finished report/export job's file into a
// tagged Media object -- see the plan's "Client-side promotion: file ->
// Media" section. Driven by store/jobsPoll.ts once a tracked task reaches
// Celery SUCCESS.
import { API_BASE } from "../config";
import { downloadProcessedFile, uploadMedia, getOrCreateTagHandle, tagAndDescribeMedia } from "./jobsApi";
import { clickDownloadLink } from "./downloadFile";

export type JobKind = "report" | "export";

export interface PromoteResult {
  handle: string;
  desc: string;
}

const REPORT_URL_RE = /^\/api\/reports\/([^/]+)\/file\/processed\//;
const EXPORT_URL_RE = /^\/api\/exporters\/([^/]+)\/file\/processed\//;
// Media archives aren't listed by exporters.py -- export_media (tasks.py)
// hands back its own `/api/media/archive/<uuid>.zip`, with no plugin id to
// look up a name for. There's only ever the one kind of media export, so
// the label is a constant rather than something fetched. Exported: also
// what jobsPoll.ts checks to route a media archive to
// downloadArchiveLocally() below instead of promoteJob() -- see its own
// doc comment on why that one's never promoted.
export const MEDIA_ARCHIVE_URL_RE = /^\/api\/media\/archive\//;

// Gramps plugin display names carry a GTK mnemonic marker (an underscore
// before the accelerator letter, e.g. "GE_DCOM", "_Web Family Tree") --
// meaningless outside a desktop menu, so it's stripped for use in a Media
// desc. A literal underscore (rare) would need doubling to survive; none
// of Gramps' own report/exporter names do.
export function stripMnemonic(name: string): string {
  return name.replace(/_/g, "");
}

/** The desc an export's Media object gets, from the exporter's own plugin
 * name. Shared by both paths that can name an export -- the dialog that
 * dispatched it (which has the name already) and the catch-up sweep below
 * (which has to fetch it) -- so a job labels itself identically however it
 * was found. Unlike a report, an export has no subject to distinguish one
 * run from another, so there is nothing here the dispatching tab knows and
 * the sweep doesn't. */
export function exportLabel(exporterName: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = stripMnemonic(exporterName);
  // "JSON Export" is already called an export; only the formats named for
  // themselves ("GEDCOM", "vCard") need the word adding.
  const label = /\bexports?$/i.test(name) ? name : `${name} export`;
  return `${label} — ${stamp}`;
}

// Printable characters no filesystem (Windows included) will take.
// Control characters and everything outside ASCII are handled by
// NON_ASCII below.
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g;

// Anything that isn't printable ASCII. Download names are deliberately
// held to that: the labels themselves keep their em dash, but a file name
// travels -- into ZIP archives, over FTP, onto a USB stick read by
// something older than the machine that wrote it -- and every one of those
// hops has its own idea of the encoding. The filesystems are not the
// constraint here (NTFS, APFS and ext4 all take the full label as-is);
// what comes after them is.
const NON_ASCII = /[^\x20-\x7e]+/g;

// Unicode punctuation with an obvious ASCII spelling, mapped rather than
// replaced wholesale so the common cases -- above all the em dash in every
// label this app builds -- read the way they looked.
const PUNCTUATION_TO_ASCII: [RegExp, string][] = [
  [/[‐-―−]/g, "-"], // hyphens, dashes, minus sign
  [/[‘’‚‛]/g, "'"], // curly single quotes
  [/[“”„‟]/g, '"'], // curly double quotes -- then unsafe
  [/…/g, "..."], // ellipsis
  [/[   ]/g, " "], // non-breaking spaces
];

/** Folds one label down to printable ASCII, keeping as much of it legible
 * as the alphabet allows: named punctuation is spelled out, accented Latin
 * letters lose their accents rather than the letter, and only what's left
 * after that becomes a hyphen.
 *
 * A name in a script with no ASCII spelling at all (a report plugin
 * localized into Japanese, say) does come out as hyphens -- the date the
 * labels end with then carries the name on its own, which is why
 * downloadFileName trims them off the ends rather than leaving a row of
 * them. */
function toAsciiStem(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PUNCTUATION_TO_ASCII) {
    out = out.replace(pattern, replacement);
  }
  // NFKD splits an accented letter into a plain letter plus a combining
  // mark, so dropping the marks leaves the letter behind ("Müller" ->
  // "Muller"); it also folds ligatures and full-width forms into ASCII.
  out = out.normalize("NFKD").replace(/\p{M}+/gu, "");
  out = out.replace(UNSAFE_FILENAME_CHARS, "-").replace(NON_ASCII, "-");
  return out.replace(/-{2,}/g, "-").replace(/\s+/g, " ").trim();
}

/** The name a promoted job's file should be offered to the browser under:
 * the same label the Output view shows, carrying the extension the job's
 * own result URL had (`.../file/processed/<uuid>.jsonl`).
 *
 * That URL is the only place the real extension survives -- by the time
 * the file is a Media object, the server has already replaced it with one
 * guessed from the MIME type (see jobsApi.ts's FILE_NAME_ATTRIBUTE), which
 * for a format with no registered MIME is `.bin`. Multi-part extensions
 * are kept whole: the endpoint's own filename pattern allows them
 * (`(\.[\w\.]*)` in exporters.py). */
export function downloadFileName(desc: string, url: string): string {
  const base = url.split("/").pop() ?? "";
  const dot = base.indexOf(".");
  const extension = dot === -1 ? "" : base.slice(dot);
  let stem = truncateBytes(toAsciiStem(desc), MAX_STEM_BYTES);
  // Leading dots hide the file on Unix; trailing dots and spaces are
  // silently stripped by Win32, so a name that ends in one isn't the name
  // the user gets back. Hyphens go too, since they're what an unspellable
  // character leaves behind.
  // Both ends take the same class: stripping a hyphen can expose the
  // space that was next to it (an unspellable name in front of the label's
  // " - <date>"), and a name that starts with a space is as unhelpful as
  // one that starts with a hyphen.
  stem = stem.replace(/^[.\- ]+/, "").replace(/[.\- ]+$/, "");
  if (WINDOWS_RESERVED.test(stem)) stem = `${stem}-file`;
  return `${stem || "download"}${extension}`;
}

// Windows device names, reserved whatever extension follows ("CON.txt" is
// still CON). Unreachable from the labels this app builds, which always
// end in " — <date>", but this is the kind of guarantee a filename helper
// should make on its own rather than inherit from its callers.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Every mainstream filesystem stops a path component at 255 -- bytes on
// Linux, UTF-16 code units on NTFS, characters on APFS. 200 leaves room
// for the extension and for a browser's own "(1)" de-duplication suffix.
// Counted in bytes, which is the strictest of the three: one byte per
// character once toAsciiStem has run, but the helper doesn't assume its
// input has been through that.
const MAX_STEM_BYTES = 200;

/** Cuts `text` to at most `max` UTF-8 bytes, on a character boundary --
 * iterating a string yields whole code points, so no multi-byte character
 * (and no surrogate pair) is ever left half-written. */
function truncateBytes(text: string, max: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= max) return text;
  let out = "";
  let bytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > max) break;
    out += char;
    bytes += size;
  }
  return out;
}

/** Classifies a finished job's result `url` and derives a generic,
 * non-subject-specific label for it -- report/export *type* is recoverable
 * this way even once the dispatching tab (and its in-memory `options`) is
 * long gone, per the plan's "Closed-tab recovery" decision. Used only when
 * the caller has nothing more specific: jobsPoll.ts's catch-up sweep. The
 * dispatch-scoped loop instead builds a richer desc itself, from the
 * `options` it still has in memory at that point. */
export async function describeGenericJob(token: string, kind: JobKind, url: string): Promise<string> {
  if (kind === "export" && MEDIA_ARCHIVE_URL_RE.test(url)) return exportLabel("Media");
  const stamp = new Date().toISOString().slice(0, 10);
  const [urlRe, apiPath, idFallback] =
    kind === "report"
      ? ([REPORT_URL_RE, "reports", "Report"] as const)
      : ([EXPORT_URL_RE, "exporters", "Export"] as const);
  const id = urlRe.exec(url)?.[1];
  let name = id ?? idFallback;
  if (id) {
    try {
      const query = kind === "report" ? "?include_help=false" : "";
      const res = await fetch(`${API_BASE}/api/${apiPath}/${encodeURIComponent(id)}${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) name = stripMnemonic(((await res.json()).name as string | undefined) ?? name);
    } catch {
      // Falls back to the raw id -- this is only ever a display label,
      // never used to drive another request.
    }
  }
  return kind === "report" ? `${name} — ${stamp}` : exportLabel(name);
}

/** Promotes a finished report/export job's processed file to a tagged Media
 * object (plan §1, steps 1-4): download the processed file, upload it as
 * Media, get-or-create the `report`/`export` Tag, then set `desc` and
 * attach the tag. `url` is the task result's own
 * `.../file/processed/<uuid>.<ext>` path; `desc` is the human label to set
 * (see describeGenericJob for the orphan-recovery case, or a caller-built
 * subject-specific one for the live dispatch-scoped case).
 *
 * Returns null if the processed file was already claimed -- an earlier
 * poll tick, or another tab/session of the same user, racing to promote
 * the same job -- a normal, silent outcome of the endpoint's own
 * delete-on-read behavior (see jobsApi.ts's downloadProcessedFile), not a
 * failure. */
export async function promoteJob(token: string, kind: JobKind, url: string, desc: string): Promise<PromoteResult | null> {
  const file = await downloadProcessedFile(token, url);
  if (!file) return null;
  const handle = await uploadMedia(token, file.blob, file.contentType);
  const tagHandle = await getOrCreateTagHandle(token, kind);
  await tagAndDescribeMedia(token, handle, desc, tagHandle, downloadFileName(desc, url));
  return { handle, desc };
}

/** A media-archive export's alternative to promoteJob(): the file goes
 * straight to the user's disk instead of back into the tree as a new Media
 * object. Re-uploading a zip of the tree's *entire existing* media
 * collection as a fresh Media object is nothing but a self-inflicted quota
 * hit -- no new information, one full copy of everything the tree already
 * has, permanently, with no cleanup and no opt-out (discussion #4, F4).
 *
 * Still goes through downloadProcessedFile(), so it keeps the same
 * exactly-once guarantee promoteJob() has (delete-on-read server-side):
 * whichever tab/sweep tick gets here first is the one that both delivers
 * the file to its user *and* consumes it. Returns false, the same "already
 * claimed" outcome promoteJob() signals with null, if that's already
 * happened. */
export async function downloadArchiveLocally(token: string, url: string, desc: string): Promise<boolean> {
  const file = await downloadProcessedFile(token, url);
  if (!file) return false;
  const objectUrl = URL.createObjectURL(file.blob);
  try {
    clickDownloadLink(objectUrl, downloadFileName(desc, url));
  } finally {
    // Safari needs the URL to outlive the click; a task turn is enough.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
  return true;
}
