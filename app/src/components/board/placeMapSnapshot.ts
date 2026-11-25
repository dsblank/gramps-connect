// A still picture of the map around a place, for a place card at the
// Dossier size. Cards are SVG and move with the board, so a live map can't
// sit inside one; instead one hidden MapLibre map (the same basemap as
// View > Map) is moved to each place in turn and its canvas copied out.
// maplibre-gl is loaded only when the first picture is asked for.
import type { Map as MapLibreMap } from "maplibre-gl";

/** The picture's size on the card, in board units (CSS pixels at 100%). */
export const SNAPSHOT_W = 260;
export const SNAPSHOT_H = 140;
/** Drawn at 3x, so it stays sharp when the board is zoomed in. */
const PIXEL_RATIO = 3;
const ZOOM = 10;
const TIMEOUT_MS = 20000;

const cache = new Map<string, Promise<string | null>>();
let mapPromise: Promise<{ map: MapLibreMap; dark: boolean; setDark: (dark: boolean) => Promise<void> }> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function hiddenMap(dark: boolean) {
  if (!mapPromise) {
    mapPromise = (async () => {
      const [maplibregl, { mapStyleUrl }] = await Promise.all([import("maplibre-gl"), import("../visuals/mapStyles")]);
      const container = document.createElement("div");
      // Off screen but laid out, so WebGL draws it.
      Object.assign(container.style, { position: "fixed", left: "-10000px", top: "0", width: `${SNAPSHOT_W}px`, height: `${SNAPSHOT_H}px`, pointerEvents: "none" });
      container.setAttribute("aria-hidden", "true");
      document.body.appendChild(container);
      const map = new maplibregl.Map({
        container,
        style: mapStyleUrl(dark, null),
        center: [0, 0],
        zoom: ZOOM,
        interactive: false,
        attributionControl: false,
        pixelRatio: PIXEL_RATIO,
        fadeDuration: 0,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
      await new Promise<void>((resolve) => map.once("style.load", () => resolve()));
      const state = {
        map,
        dark,
        setDark: async (next: boolean) => {
          if (state.dark === next) return;
          state.dark = next;
          map.setStyle(mapStyleUrl(next, null));
          await new Promise<void>((resolve) => map.once("style.load", () => resolve()));
        },
      };
      return state;
    })();
    mapPromise.catch(() => {
      mapPromise = null;
    });
  }
  const state = await mapPromise;
  await state.setDark(dark);
  return state.map;
}

function settle(map: MapLibreMap): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), TIMEOUT_MS);
    map.once("idle", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** A data: URL of the map centred on [lat, long], or null if it can't be
 * drawn (offline, no WebGL). One at a time, cached for the session. */
export function placeMapSnapshot(lat: number, long: number, dark: boolean): Promise<string | null> {
  const key = `${lat.toFixed(5)},${long.toFixed(5)},${dark ? "d" : "l"}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const next = queue.then(async () => {
    try {
      const map = await hiddenMap(dark);
      const settled = settle(map);
      map.jumpTo({ center: [long, lat], zoom: ZOOM });
      // Even when it's already there, so "idle" comes round again.
      map.triggerRepaint();
      const done = await settled;
      if (!done) return null;
      return map.getCanvas().toDataURL("image/jpeg", 0.85);
    } catch {
      return null;
    }
  });
  queue = next;
  // A failure isn't remembered, so the next look tries again.
  next.then((url) => {
    if (!url) cache.delete(key);
  });
  cache.set(key, next);
  return next;
}
