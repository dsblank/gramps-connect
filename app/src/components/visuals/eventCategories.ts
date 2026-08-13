// The colour identity shared by the Timeline's dots and its legend.
//
// Gramps has 47 built-in event types plus any number of custom ones, which
// is far past the point where a categorical palette can stay tellable apart
// -- so this folds them into three named categories plus "Other", the same
// call gramps-web makes in charts/Timeline.js (it names five and greys the
// rest). Three is the cap here rather than five because the Timeline is a
// dot plot: every category is on screen simultaneously, so the palette has
// to clear its separation gates across *all* pairs, not just adjacent ones,
// and three validated hues is what that allows. Nothing is lost -- the
// legend doubles as a filter, so any single one of the 47 can be isolated
// on demand; what's dropped is only the claim that a colour alone can
// distinguish 47 things, which it can't.
//
// Assignment is by category identity and fixed forever: Birth is slot 1
// whether or not any births are in view, so filtering the legend never
// repaints the categories that survive.

export type EventCategory = "birth" | "death" | "marriage" | "other";

/** Which event types fold into which category. Matched against the type text
 * views.ts's formatEventType produces, so a custom type named "Birth" lands
 * with the built-in one -- which is what someone naming it that intended. */
const CATEGORY_BY_TYPE: Record<string, EventCategory> = {
  Birth: "birth",
  Baptism: "birth",
  Christening: "birth",
  "Adult Christening": "birth",
  Stillbirth: "birth",
  Death: "death",
  Burial: "death",
  Cremation: "death",
  "Cause Of Death": "death",
  Probate: "death",
  Will: "death",
  Marriage: "marriage",
  "Alternate Marriage": "marriage",
  "Marriage Settlement": "marriage",
  "Marriage License": "marriage",
  "Marriage Contract": "marriage",
  "Marriage Banns": "marriage",
  Engagement: "marriage",
  Divorce: "marriage",
  "Divorce Filing": "marriage",
  Annulment: "marriage",
};

export function categoryOf(eventType: string): EventCategory {
  return CATEGORY_BY_TYPE[eventType] ?? "other";
}

export interface CategorySpec {
  key: EventCategory;
  label: string;
  /** What the legend says this category covers, for its tooltip. */
  hint: string;
}

/** Legend order, which is also colour-slot order -- never sorted by count.
 * "Other" last, as the fold target. */
export const CATEGORIES: CategorySpec[] = [
  { key: "birth", label: "Birth", hint: "Birth, Baptism, Christening, Stillbirth" },
  { key: "death", label: "Death", hint: "Death, Burial, Cremation, Probate, Will" },
  { key: "marriage", label: "Marriage", hint: "Marriage, Engagement, Divorce, Annulment" },
  { key: "other", label: "Other", hint: "Census, Residence, Occupation, and every other type" },
];

/** Slots 1-3 of the validated categorical palette, per mode -- the dark
 * column is the same three hues re-stepped for a dark surface, not a
 * separate palette, and the set was checked across all pairs in both modes
 * (worst CVD ΔE 9.2 light / 9.4 dark against a >= 8 target).
 *
 * "Other" is deliberately *not* a fourth slot: as a filled grey dot it
 * collides with aqua under deuteranopia (ΔE 3.9), and any grey chromatic
 * enough to separate stops reading as the neutral catch-all. It's drawn as
 * a hollow ring in the muted text colour instead (see dotStyle) -- a
 * different mark, not a fourth colour, so it recedes the way a catch-all
 * should and never enters the palette's pair math at all. */
const FILL: Record<Exclude<EventCategory, "other">, { light: string; dark: string }> = {
  birth: { light: "#2a78d6", dark: "#3987e5" },
  death: { light: "#eb6834", dark: "#d95926" },
  marriage: { light: "#1baf7a", dark: "#199e70" },
};

/** Slot 1, for a visual whose marks are a single series and so need one
 * colour rather than a palette -- the Map, where every marker is a place and
 * magnitude is carried by radius instead.
 *
 * Not the app's own accent (`--mantine-primary-color-filled`), which is what
 * this used to be: in dark mode Mantine resolves that to #0f5aa7, which
 * measures 2.25:1 against the dark body -- under the 3:1 floor a mark has to
 * clear, and in practice invisible, a dark blue dot on a dark basemap. The
 * markers simply weren't there to a dark-mode reader. Slot 1 is stepped per
 * mode for exactly this and clears 3:1 on both Mantine surfaces. */
export const SERIES_1 = { light: "#2a78d6", dark: "#3987e5" };

export function seriesColor(dark: boolean): string {
  return dark ? SERIES_1.dark : SERIES_1.light;
}

export interface DotStyle {
  /** Fill colour, or null for the hollow "Other" ring. */
  fill: string | null;
  stroke: string;
}

/** How a category's dot is painted. `muted` is the surface-appropriate
 * secondary text colour, passed in rather than hardcoded so the ring tracks
 * the Mantine theme's own ink. */
export function dotStyle(category: EventCategory, dark: boolean, muted: string): DotStyle {
  if (category === "other") return { fill: null, stroke: muted };
  const fill = FILL[category][dark ? "dark" : "light"];
  return { fill, stroke: fill };
}
