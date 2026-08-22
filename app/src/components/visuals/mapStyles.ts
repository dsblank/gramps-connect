// Shared between MapCanvas.tsx (the main geography view) and
// StoryMapBackground.tsx (the Story presentation's background map) -- the
// one place both basemap choices and the OpenHistoricalMap (OHM) date
// filter live, so the two don't drift into two different implementations
// of the same three modes (see HANDOFF-ohm-map-modes.md).
import type { Map as MapLibreMap } from "maplibre-gl";
// A CJS module with no browser global to patch onto (it only self-attaches
// to `window.maplibregl`, which our namespace import never creates) -- the
// named export below is what its `module.exports` branch actually produces,
// and it's what both callers use directly rather than the `map.filterByDate`
// method the plugin's own README shows for a script-tag install.
import { filterByDate } from "@openhistoricalmap/maplibre-gl-dates";

/** The same OpenFreeMap "liberty" style gramps-web uses for its light
 * basemap, so the two clients' maps look like the same product in light
 * mode. Free, key-less, and hosted -- which does mean a map (unlike every
 * other view in this app) needs the network even though its *data* is
 * local. */
export const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
/** OpenFreeMap's own "dark" style renders every layer, including water, in
 * the same near-zero-saturation gray (confirmed against their own demo at
 * openfreemap.org) -- there's no hue anywhere to tell land from water at a
 * glance. CARTO's Dark Matter style is the free, key-less alternative with
 * an actual (if muted) blue-gray palette -- water and major roads read as
 * distinct from background and from each other. */
export const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** OHM's own vector style -- one cartography regardless of light/dark,
 * matching gramps-web's choice (see HANDOFF-ohm-map-modes.md). */
export const OHM_STYLE = "https://www.openhistoricalmap.org/map-styles/main/main.json";

/** The three selectable modes wherever a historical map is shown. "auto" and
 * "historical" both render OHM tiles filtered to a year -- they differ only
 * in where that year comes from (context vs. a user-dragged slider), which
 * is why both map components take a single `ohmYear: number | null` rather
 * than the mode itself: "standard" and an "auto" with nothing to derive a
 * year from look identical to the map, and are meant to. */
export type MapMode = "auto" | "standard" | "historical";

/** A stable key for "would setStyle() actually change anything" -- swapping
 * light/dark never matters once OHM is showing (its cartography doesn't
 * have a dark variant), so a slider drag that changes `ohmYear`'s value
 * without leaving historical/auto mode must not trip a style reload. */
export function mapStyleKey(dark: boolean, ohmYear: number | null): string {
  return ohmYear != null ? "ohm" : dark ? "dark" : "light";
}

export function mapStyleUrl(dark: boolean, ohmYear: number | null): string {
  return ohmYear != null ? OHM_STYLE : dark ? STYLE_DARK : STYLE_LIGHT;
}

/** Swaps a map's style as a true crossfade -- the old and new basemaps
 * dissolving into each other, not one fading out before the other fades in.
 * A single WebGL map can only ever show one style at a time, so this fakes
 * it: a snapshot of the *old* style (a plain `<img>`, frozen) is overlaid
 * over the live map at full opacity, the live map underneath is swapped to
 * the new style immediately and left to load, and once it's actually
 * finished drawing (`idle`, not `style.load` -- that fires before a single
 * tile of the new style has painted) the snapshot dissolves away, revealing
 * the new style continuously as it goes rather than snapping to it. This
 * also means the old map stays on screen, fully intact, for however long
 * the new style's tiles take to fetch -- no blank/loading gap either way,
 * unlike fading through transparent would give.
 *
 * Requires `preserveDrawingBuffer: true` on the map (see both callers'
 * constructors) -- without it, `toDataURL()` on the canvas can come back
 * blank depending on exactly when the browser clears the drawing buffer
 * after compositing. Falls back to an instant, unfaded swap if the snapshot
 * can't be taken at all (a tainted canvas, or a browser that disallows it) --
 * a plain setStyle() rather than no swap.
 *
 * `beforeSwap` runs at the same moment as setStyle(), so a caller's own
 * `setReady(false)` -- which gates its layer re-add effect -- flips exactly
 * when setStyle() actually discards those layers. */
export function crossfadeStyleSwap(map: MapLibreMap, styleUrl: string, beforeSwap: () => void, duration = 300): void {
  const container = map.getContainer();
  // The container is `position: absolute` but neither caller gives it its
  // own `z-index` -- which means it *doesn't* establish a stacking context
  // of its own, and the overlay's z-index below would then be compared not
  // just against the container's own children but against the container's
  // own siblings elsewhere on the page (StoryView.tsx's content panel,
  // MapView.tsx's PlaceCard popup, both positioned with their own z-index).
  // Found live: the overlay ended up painting over the story's content
  // panel instead of staying confined beneath it. Setting a z-index here
  // (any value; 0 keeps this box in the same paint bucket it was already
  // in) traps the overlay inside this container instead.
  if (!container.style.zIndex) container.style.zIndex = "0";
  let snapshotUrl: string | null = null;
  try {
    snapshotUrl = map.getCanvas().toDataURL("image/png");
  } catch {
    // Tainted canvas or an unsupported browser -- no crossfade, just swap.
  }

  beforeSwap();
  map.setStyle(styleUrl);
  if (!snapshotUrl) return;

  const overlay = document.createElement("img");
  overlay.src = snapshotUrl;
  overlay.alt = "";
  Object.assign(overlay.style, {
    position: "absolute", inset: "0", width: "100%", height: "100%",
    zIndex: "5", pointerEvents: "none", transition: `opacity ${duration}ms ease`,
  });
  container.appendChild(overlay);
  map.once("idle", () => {
    // rAF, not set on the same tick as append -- a transition needs the
    // browser to have painted the starting opacity (1, the element's
    // default) at least once before a change to it will animate rather
    // than just jumping straight to the end state.
    requestAnimationFrame(() => { overlay.style.opacity = "0"; });
    window.setTimeout(() => overlay.remove(), duration + 50);
  });
}

/** Filters an OHM style's own vector layers to a year. A no-op on any layer
 * without a `source-layer` -- which is every layer either map component
 * adds itself (GeoJSON place markers, clusters, the story's pin) -- and
 * idempotent to call again on every year change: the plugin rewrites a
 * `let`-bound variable in place rather than re-wrapping each layer's filter,
 * so a slider drag never needs a style reload to take effect. */
export function applyOhmYear(map: MapLibreMap, year: number): void {
  filterByDate(map, String(Math.round(year)));
}
