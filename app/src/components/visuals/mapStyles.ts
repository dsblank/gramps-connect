// The basemaps and their OpenHistoricalMap (OHM) date filter live in
// @gramps-connect/story's player, shared by MapCanvas.tsx (the main
// geography view) and the story player, so the two can't drift into two
// implementations of the same three modes. What stays here is app-only:
// the overlay date gate in terms of a Gramps Date.
import { Modifier, getStartDate, getStopDate, isCompound, type GrampsDate } from "@gramps-connect/gramps-date";

export {
  applyOhmYear, crossfadeStyleSwap, mapStyleKey, mapStyleUrl, OHM_STYLE, STYLE_DARK, STYLE_LIGHT,
  type MapMode,
} from "@gramps-connect/story/player";

/** Whether a Place's own name.date should be considered "in effect" at
 * `ohmYear` -- what gates an image overlay attached to that place's
 * visibility (see MapCanvas.tsx's overlay effects; the story player
 * makes the same check on the EDTF form of this date, storyDoc.ts, and the plan: an overlay's visible date range is read from the
 * Place it's attached to, not stored on the overlay itself). No date at
 * all, or no year context (ohmYear null -- standard mode, or auto/
 * historical with nothing to derive a year from), means always visible: an
 * undated overlay (e.g. a hand-drawn boundary that doesn't depend on any
 * particular era) should never disappear just because historical mode
 * happens to be on. A TEXTONLY date (free text, no structured year) has
 * nothing to compare either, so it's treated the same as no date at all. */
export function overlayDateVisible(date: GrampsDate | undefined, ohmYear: number | null): boolean {
  if (!date || ohmYear === null) return true;
  const startYear = getStartDate(date)[2];
  if (!startYear) return true;
  if (date.modifier === Modifier.BEFORE || date.modifier === Modifier.TO) return ohmYear <= startYear;
  if (date.modifier === Modifier.AFTER || date.modifier === Modifier.FROM) return ohmYear >= startYear;
  const stopYear = isCompound(date) ? getStopDate(date)[2] : startYear;
  if (!stopYear) return true;
  const minYear = Math.min(startYear, stopYear);
  const maxYear = Math.max(startYear, stopYear);
  return ohmYear >= minYear && ohmYear <= maxYear;
}
