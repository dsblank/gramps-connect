// Tools -> Fix Place Name Languages: a one-time repair for places whose
// primary name is outranked in titles by an alternate name.
//
// A title picks each place's first name in the place format's language
// (placeDisplay.ts nameAt, ported from Gramps' location.py __get_name),
// primary name first. Wikidata's "Replace the name" used to give the new
// primary name Wikidata's language ("en") while keeping the replaced name
// on as an alternate in its own, usually blank, language -- so with a
// blank-language place format the old name kept winning, and titles
// (stored and automatic) still showed it. applyWikidataLookupResult no
// longer does that; this fixes places it already did it to, by giving the
// primary name the format's language.
//
// A stored title that was following the old names (it equals what the
// format built before the fix) is rebuilt too, for every place whose
// built title changes -- including places further down, whose titles
// include a fixed place's name.
import { getToken } from "../auth/auth";
import { fetchPlainObject, updateObject } from "./objectsApi";
import { formatPlace, isEmptyDate, type PlaceRecord } from "./placeDisplay";
import { completePlaceIndex } from "./placeIndex";
import { getDisplaySettings } from "./displaySettings";
import { PLACE_VIEW } from "./views";

export interface PlaceLanguageFix {
  handle: string;
  grampsId: string;
  /** The primary name's value, for showing. */
  name: string;
  /** Set when the primary name's language changes: from -> to. */
  lang: { from: string; to: string } | null;
  /** Set when the stored title is rebuilt: from -> to. */
  title: { from: string; to: string } | null;
}

/** What the repair would change, or null while the Places cache isn't
 * complete yet. Empty when there's nothing to fix. */
export function findPlaceLanguageFixes(): PlaceLanguageFix[] | null {
  const idx = completePlaceIndex();
  if (!idx) return null;
  const settings = getDisplaySettings();
  const fmt = settings.place.formats[settings.place.active] ?? settings.place.formats[0];
  const lang = fmt.language;

  const fixed = new Map<string, PlaceRecord>();
  for (const [handle, place] of idx.places) {
    const name = place.name;
    if (!name || (name.lang ?? "") === lang || !isEmptyDate(name.date)) continue;
    if (!place.altNames.some((a) => (a.lang ?? "") === lang && isEmptyDate(a.date))) continue;
    fixed.set(handle, { ...place, name: { ...name, lang } });
  }
  if (fixed.size === 0) return [];

  const before = (h: string) => idx.places.get(h);
  const after = (h: string) => fixed.get(h) ?? idx.places.get(h);
  const fixes: PlaceLanguageFix[] = [];
  for (const [handle, place] of idx.places) {
    const from = formatPlace(before, handle, fmt);
    const to = formatPlace(after, handle, fmt);
    const stored = idx.titles.get(handle) ?? "";
    const title = from !== null && to !== null && from !== to && stored === from ? { from, to } : null;
    const langFix = fixed.has(handle) ? { from: place.name?.lang ?? "", to: lang } : null;
    if (!title && !langFix) continue;
    fixes.push({
      handle,
      grampsId: idx.grampsIds.get(handle) ?? "",
      name: place.name?.value ?? "",
      lang: langFix,
      title,
    });
  }
  return fixes.sort((a, b) => a.grampsId.localeCompare(b.grampsId));
}

/** Saves `fixes`, one place at a time (each its own transaction, so each
 * shows in the place's History and can be undone there). A place changed
 * since the preview -- its name's language or stored title no longer what
 * the fix expects -- has that part skipped. Returns the failures. */
export async function applyPlaceLanguageFixes(
  fixes: PlaceLanguageFix[],
  onProgress: (done: number) => void
): Promise<{ grampsId: string; message: string }[]> {
  const token = await getToken();
  const failures: { grampsId: string; message: string }[] = [];
  for (const [i, fix] of fixes.entries()) {
    try {
      const data = await fetchPlainObject(token, PLACE_VIEW, fix.handle);
      const name = (data.name ?? {}) as Record<string, unknown>;
      let changed = false;
      if (fix.lang && ((name.lang as string | undefined) ?? "") === fix.lang.from) {
        data.name = { ...name, lang: fix.lang.to };
        changed = true;
      }
      if (fix.title && data.title === fix.title.from) {
        data.title = fix.title.to;
        changed = true;
      }
      if (changed) await updateObject(token, PLACE_VIEW, fix.handle, data);
    } catch (err) {
      failures.push({ grampsId: fix.grampsId, message: err instanceof Error ? err.message : String(err) });
    }
    onProgress(i + 1);
  }
  return failures;
}
