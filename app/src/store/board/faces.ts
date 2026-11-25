// Who's in a photo, for the Evidence Board's photo card: what the tree says
// (the photo's backlinks, fetched from the server) with the board's own
// unsaved changes laid over it, so marking a face, adding someone or taking
// them out shows in the list straight away, before Save.
//
// A person is "in" a photo when their media_list references it; the
// reference's rect is their face (Gramps' MediaRef.rect, percent
// [left, top, right, bottom]). Other kinds of record are listed only when
// their reference marks a region, as the full-size view does.
import type { GrampsClass, Records } from "./records";
import { titleOf } from "./view";

export interface PhotoSubject {
  cls: GrampsClass;
  handle: string;
  label: string;
  /** The marked region, or null for someone in the photo with no face marked. */
  rect: number[] | null;
}

const BACKLINK_CLASS: Record<string, GrampsClass> = {
  person: "Person", family: "Family", event: "Event", place: "Place", source: "Source",
  citation: "Citation", repository: "Repository", media: "Media", note: "Note",
};

type Ref = { ref?: string; rect?: number[] | null };

function validRect(rect: unknown): number[] | null {
  return Array.isArray(rect) && rect.length === 4 && rect[2] > rect[0] && rect[3] > rect[1] ? (rect as number[]) : null;
}

function personLabel(obj: Record<string, unknown>): string {
  const n = obj.primary_name as { first_name?: string; surname_list?: { surname?: string }[] } | undefined;
  return [n?.first_name, n?.surname_list?.[0]?.surname].filter(Boolean).join(" ");
}

/** Everyone the tree has in photo `media`, from its extended record's raw
 * backlinks (fetchObjectExtended). */
export function subjectsFromBacklinks(detail: { extended?: Record<string, unknown> } | null, media: string): PhotoSubject[] {
  const backlinks = (detail?.extended?.backlinks as Record<string, ({ handle: string; media_list?: Ref[] } & Record<string, unknown>)[]> | undefined) ?? {};
  const out: PhotoSubject[] = [];
  for (const [type, objs] of Object.entries(backlinks)) {
    const cls = BACKLINK_CLASS[type];
    if (!cls) continue;
    for (const obj of objs) {
      const ref = obj.media_list?.find((m) => m.ref === media);
      if (!ref) continue;
      const rect = validRect(ref.rect);
      if (cls !== "Person" && !rect) continue;
      const label = cls === "Person" ? personLabel(obj) : String(obj.gramps_id ?? "");
      out.push({ cls, handle: obj.handle, label: label || cls, rect });
    }
  }
  return out;
}

/** `fromTree` (the server's list) with the board's working copy laid over
 * it: a record the board has loaded counts as it is on the board. */
export function subjectsOnBoard(fromTree: PhotoSubject[], working: Records, media: string): PhotoSubject[] {
  const out: PhotoSubject[] = [];
  for (const s of fromTree) if (!working[s.handle]) out.push(s);
  for (const r of Object.values(working)) {
    const list = Array.isArray(r.media_list) ? (r.media_list as Ref[]) : [];
    const ref = list.find((m) => m.ref === media);
    if (!ref) continue;
    const rect = validRect(ref.rect);
    if (r._class !== "Person" && !rect) continue;
    out.push({ cls: r._class, handle: r.handle, label: titleOf(r.handle, working), rect });
  }
  // People first, then by name, so the list doesn't reshuffle as records load.
  return out.sort((a, b) => Number(b.cls === "Person") - Number(a.cls === "Person") || a.label.localeCompare(b.label));
}

/** A person's photos (images they reference), first one first: the first
 * is the one on their card, as in Gramps. */
export function photosOf(person: string, records: Records): { media: string; rect: number[] | null }[] {
  const r = records[person];
  const list = r && Array.isArray(r.media_list) ? (r.media_list as Ref[]) : [];
  return list
    .filter((m) => typeof m.ref === "string" && String(records[m.ref]?.mime ?? "").startsWith("image/"))
    .map((m) => ({ media: m.ref as string, rect: validRect(m.rect) }));
}
