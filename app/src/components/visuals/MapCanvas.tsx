import { useEffect, useRef, useState } from "react";
// Namespace import: maplibre-gl v5 has no default export.
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, Point as GeoJsonPoint } from "geojson";
import { Alert, Box, useComputedColorScheme } from "@mantine/core";
import type { MapPlace } from "../../store/visualData";
import { readVisualColors } from "./cssVar";
import { seriesColor } from "./eventCategories";
import "maplibre-gl/dist/maplibre-gl.css";
import { t } from "../../i18n/i18n";
import { applyOhmYear, crossfadeStyleSwap, mapStyleKey, mapStyleUrl } from "./mapStyles";
// maplibre-gl loads its tile-parsing/clustering work off the main thread via
// `new Worker(new URL(\`./${name}\`, import.meta.url))`, with the filename
// built from a template literal at runtime -- Vite's static asset scanner
// only recognises a literal string in that position, so it never sees this
// one and never emits the worker into the build at all. The failure is easy
// to miss: the *style* still loads (background, controls, attribution all
// come from the main thread), so the map looks present. Everything that
// needs the worker silently doesn't -- the vector basemap's own roads/
// labels, and our clustered GeoJSON places source alike, since GeoJSON
// clustering is worker-side too.
//
// setWorkerUrl() is maplibre's documented way to point at a worker script a
// bundler can't discover on its own -- but the worker file isn't self-
// contained: it does `import ... from "./maplibre-gl-shared.mjs"`, a plain
// relative specifier the package ships expecting a same-directory sibling,
// not a bundler. A Vite `?url` import fingerprints only the one file asked
// for, which breaks that relative import (it resolves to an unhashed
// sibling that was never emitted) rather than fixing it. Both files are
// instead copied verbatim into public/ by scripts/copy-wasm.mjs, under
// their own names, so the relative import between them stays intact and
// they're served at a fixed path the same way the sql.js WASM files are
// (see registry.ts's locateFile).
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

/** Where the user last left the map, so reopening doesn't jump back to a
 * world view. Same idea (and same purpose) as gramps-web's own
 * getMapViewport/saveMapViewport. */
const VIEWPORT_KEY = "gramps-connect:map-viewport";

interface Viewport {
  lat: number;
  lng: number;
  zoom: number;
}

function loadViewport(): Viewport | null {
  try {
    const raw = window.localStorage.getItem(VIEWPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Viewport>;
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number" || typeof parsed.zoom !== "number") {
      return null;
    }
    return { lat: parsed.lat, lng: parsed.lng, zoom: parsed.zoom };
  } catch {
    return null;
  }
}

function saveViewport(viewport: Viewport): void {
  try {
    window.localStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport));
  } catch {
    // A private-mode/quota failure costs the user a remembered viewport and
    // nothing else -- not worth surfacing.
  }
}

const SOURCE = "places";
const CLUSTER_LAYER = "place-clusters";
const CLUSTER_COUNT_LAYER = "place-cluster-count";
const POINT_LAYER = "place-points";
const LABEL_LAYER = "place-labels";

interface MapCanvasProps {
  /** Already filtered by MapView's search and time filter. */
  places: MapPlace[];
  /** Bumped by the parent to request a re-fit to `places` -- e.g. after a
   * search narrows them down. A counter rather than a boolean so consecutive
   * requests are distinguishable. */
  fitRequest: number;
  /** In-context scope mode (see ScopeChip): every place stays plotted, but
   * only these are drawn at full strength and the rest recede. Undefined
   * means "no scope" -- every marker at full strength, the whole-tree
   * default. An empty set is not the same thing and never passed: MapView
   * drops the scope entirely rather than dimming the entire map. */
  highlighted?: Set<string>;
  /** Which places a fit should frame. Defaults to `places`; set in context
   * mode, where the plotted set is the whole tree but the thing worth
   * looking at is the handful the scope picked out. */
  fitTo?: MapPlace[];
  /** The marker to ring as selected, so the record the detail card is
   * describing stays findable -- the timeline rings its selected dot for
   * the same reason. */
  selectedHandle?: string | null;
  onSelectPlace: (place: MapPlace | null) => void;
  /** Non-null switches the basemap to OpenHistoricalMap tiles filtered to
   * this year (see MapModeControl / mapStyles.ts); null is the plain
   * OpenFreeMap basemap, unfiltered. */
  ohmYear: number | null;
}

function toGeoJson(
  places: MapPlace[],
  highlighted?: Set<string>,
  selectedHandle?: string | null,
): FeatureCollection<GeoJsonPoint> {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.long, place.lat] },
      properties: {
        handle: place.handle,
        title: place.title,
        grampsId: place.grampsId,
        eventCount: place.eventCount,
        // A plain boolean on the feature rather than a second source and a
        // second layer: maplibre can branch a paint property on it (see the
        // circle-opacity expressions below), so one set of layers keeps
        // serving both modes and clustering keeps working across them.
        dim: highlighted ? !highlighted.has(place.handle) : false,
        selected: place.handle === selectedHandle,
      },
    })),
  };
}

/** Full strength, or receded to context. Applied to fill and label alike so
 * a dimmed marker's name recedes with it. */
const DIM_OPACITY = 0.15;

/** The maplibre map itself, in its own module so MapView can import() it
 * lazily -- maplibre-gl is by far the heaviest thing in this app, and a
 * session that never opens View > Map should never download it. */
export function MapCanvas({
  places, fitRequest, highlighted, fitTo, selectedHandle, onSelectPlace, ohmYear,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const dark = useComputedColorScheme("light") === "dark";

  // Latest values, for the event handlers registered once at map creation --
  // re-registering them on every prop change would mean tearing down and
  // rebuilding listeners on each filter keystroke.
  const placesRef = useRef(places);
  placesRef.current = places;
  const highlightedRef = useRef(highlighted);
  highlightedRef.current = highlighted;
  const selectedRef = useRef(selectedHandle);
  selectedRef.current = selectedHandle;
  const onSelectRef = useRef(onSelectPlace);
  onSelectRef.current = onSelectPlace;
  const ohmYearRef = useRef(ohmYear);
  ohmYearRef.current = ohmYear;

  // Create once. The style is swapped in place on a colour-scheme change (see
  // the effect below) rather than recreating the map, which would lose the
  // user's current viewport.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const saved = loadViewport();
    const map = new maplibregl.Map({
      container,
      style: mapStyleUrl(dark, ohmYearRef.current),
      center: saved ? [saved.lng, saved.lat] : [0, 20],
      zoom: saved ? saved.zoom : 1.5,
      attributionControl: { compact: true },
      // So crossfadeStyleSwap's canvas.toDataURL() snapshot reliably has the
      // last-rendered frame in it rather than a possibly-cleared buffer.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    // "style.load", not "load". `load` waits for the sprite sheet and glyph
    // ranges on top of the style itself, and if either of those stalls it
    // simply never fires -- which is exactly what happened against
    // OpenFreeMap here: the basemap painted, `isStyleLoaded()` stayed false
    // indefinitely, and so no marker was ever added to a perfectly working
    // map. "style.load" fires as soon as the style is parsed and applied,
    // which is the moment a source can be added, and it fires again after
    // each setStyle() -- so the colour-scheme swap below re-adds the layers
    // through this same path rather than needing its own.
    map.on("style.load", () => setReady(true));
    // A failed style/tile fetch is the one thing that can leave this view
    // blank for a reason the user can't guess -- the rest of the app works
    // offline, so "the map is grey" needs saying out loud.
    map.on("error", (e) => {
      const message = (e.error as Error | undefined)?.message ?? "";
      if (/style|sprite|tile|fetch|network|Failed/i.test(message)) setTileError(true);
    });
    map.on("moveend", () => {
      const center = map.getCenter();
      saveViewport({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
    });

    // Interaction handlers live here, registered once for the life of the
    // map, rather than next to the addLayer() calls they refer to: those run
    // again after every style swap, and re-registering there would stack up a
    // duplicate set of listeners each time. maplibre resolves a layer-scoped
    // listener's layer at dispatch time, so registering before the layer
    // exists is fine -- it just doesn't fire until it does.
    map.on("click", CLUSTER_LAYER, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const clusterId = feature.properties?.cluster_id as number;
      const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
      source?.getClusterExpansionZoom(clusterId).then((zoom) => {
        map.easeTo({ center: (feature.geometry as GeoJsonPoint).coordinates as [number, number], zoom });
      }).catch(() => {});
    });
    map.on("click", POINT_LAYER, (e) => {
      const handle = e.features?.[0]?.properties?.handle as string | undefined;
      const place = placesRef.current.find((p) => p.handle === handle);
      // A click *selects* (into the detail card) rather than navigating away
      // -- the card's own button is what commits to leaving the map. Same
      // positional rule as the aside's two panes: clicking in the plot
      // previews, clicking in the preview commits.
      onSelectRef.current(place ?? null);
    });
    // Clicking bare map deselects, so the card is dismissable without hunting
    // for its close button.
    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_LAYER, POINT_LAYER] })
        // queryRenderedFeatures throws on a layer that doesn't exist yet, and
        // returns nothing useful mid-style-swap.
        .filter(Boolean);
      if (hits.length === 0) onSelectRef.current(null);
    });
    for (const layer of [CLUSTER_LAYER, POINT_LAYER]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });
    }
    // Hover name, below the zoom at which the label layer kicks in -- a
    // maplibre Popup rather than React state lifted to MapView, so it
    // tracks the marker as the map moves instead of the cursor.
    map.on("mousemove", POINT_LAYER, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const title = feature.properties?.title as string | undefined;
      if (!title) return;
      popupRef.current ??= new maplibregl.Popup({
        closeButton: false, closeOnClick: false, offset: 12, className: "gramps-place-popup",
      });
      popupRef.current
        .setLngLat((feature.geometry as GeoJsonPoint).coordinates as [number, number])
        .setText(title)
        .addTo(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Deliberately creation-only: `dark` is read for the initial style and
    // then handled by the swap effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adds (or re-adds) the source and layers. Called on first load and again
  // after every setStyle(), which wipes all user-added layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const colors = readVisualColors();
    // Single series, so one colour for every marker (see seriesColor) with
    // radius carrying magnitude -- not colors.accent, which is the app's UI
    // accent and is not stepped to stay legible as a mark on a dark surface.
    const markColor = seriesColor(dark);

    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, {
        type: "geojson",
        data: toGeoJson(placesRef.current, highlightedRef.current, selectedRef.current),
        // maplibre's own clustering, which the local-cache read makes worth
        // having: the whole tree's places are handed over at once rather than
        // in viewport-sized fetches, so a tree with thousands of them would
        // otherwise be an unreadable mat of overlapping markers at low zoom.
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 13,
        // Cluster markers are sized by how many *events* they cover, not just
        // how many places -- summed here so the size encoding means the same
        // thing whether or not a group happens to be clustered.
        clusterProperties: { eventCount: ["+", ["get", "eventCount"]] },
      });
    }

    if (!map.getLayer(CLUSTER_LAYER)) {
      // One hue for every marker (this is a single series -- places), with
      // size carrying magnitude. Colouring by count as well would double-
      // encode the one thing the radius already says.
      map.addLayer({
        id: CLUSTER_LAYER,
        type: "circle",
        source: SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": markColor,
          "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 50, 26, 200, 32],
          // The 2px surface ring from the mark spec, doing real work here:
          // clusters routinely touch each other at low zoom.
          "circle-stroke-width": 2,
          "circle-stroke-color": colors.surface,
        },
      });
      map.addLayer({
        id: CLUSTER_COUNT_LAYER,
        type: "symbol",
        source: SOURCE,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
        },
        // Inside a filled mark -- the one place a label may take a colour
        // picked for the fill rather than a text token.
        paint: { "text-color": colors.surface },
      });
      map.addLayer({
        id: POINT_LAYER,
        type: "circle",
        source: SOURCE,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": markColor,
          // Dimmed markers stay clickable and keep their size -- what
          // recedes is only their weight, so the scoped ones read as
          // figure against the rest as ground.
          "circle-opacity": ["case", ["get", "dim"], DIM_OPACITY, 0.9],
          // Never below a 8px marker (r >= 4), stepping up with how much
          // happened at this place.
          "circle-radius": ["step", ["get", "eventCount"], 5, 1, 7, 5, 10, 20, 14],
          // The selected marker keeps the same size but takes a thicker ring
          // in ink instead of the surface colour -- the timeline rings its
          // selected dot the same way, and for the same reason: the detail
          // card outlives the pointer that opened it.
          "circle-stroke-width": ["case", ["get", "selected"], 3, 2],
          "circle-stroke-color": ["case", ["get", "selected"], colors.text, colors.surface],
          "circle-stroke-opacity": ["case", ["get", "dim"], DIM_OPACITY, 1],
        },
      });
      map.addLayer({
        id: LABEL_LAYER,
        type: "symbol",
        source: SOURCE,
        filter: ["!", ["has", "point_count"]],
        // Labels only once the markers have separated enough to carry them --
        // selective, not one on every point.
        minzoom: 8,
        layout: {
          "text-field": ["get", "title"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
          "text-anchor": "top",
          "text-offset": [0, 0.9],
          "text-max-width": 12,
        },
        paint: {
          "text-color": colors.text,
          "text-halo-color": colors.surface,
          "text-halo-width": 1.5,
          "text-opacity": ["case", ["get", "dim"], DIM_OPACITY, 1],
        },
      });
    }
  }, [ready, dark]);

  useEffect(() => () => {
    popupRef.current?.remove();
  }, []);

  // Colour-scheme flip, or a mode switch into/out of the OHM historical
  // style: swap the basemap. setStyle() discards every user-added source
  // and layer, but it also re-fires "style.load", which flips `ready` back
  // on and re-runs the layer effect above with the theme tokens re-resolved
  // for the new scheme -- so there's nothing to re-add here. `ready` is
  // dropped first so that effect's deps actually change.
  //
  // Keyed by mapStyleKey, not `dark`/`ohmYear` directly: OHM's cartography
  // has no dark variant, so toggling dark while it's showing must not
  // trigger a reload, and neither should a slider drag that changes
  // `ohmYear`'s value without leaving historical/auto mode (see the filter
  // effect below, which is what a same-mode year change actually needs).
  const appliedStyleKeyRef = useRef(mapStyleKey(dark, ohmYear));
  useEffect(() => {
    const map = mapRef.current;
    const key = mapStyleKey(dark, ohmYear);
    if (!map || appliedStyleKeyRef.current === key) return;
    appliedStyleKeyRef.current = key;
    crossfadeStyleSwap(map, mapStyleUrl(dark, ohmYear), () => setReady(false));
  }, [dark, ohmYear]);

  // The OHM year filter itself -- fires after a style (re)load that leaves
  // historical/auto mode on (`ready` flipping true again above), and again
  // on every slider drag that doesn't touch the style at all. Idempotent
  // per applyOhmYear's own doc, so no guard against calling it redundantly.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || ohmYear == null) return;
    applyOhmYear(map, ohmYear);
  }, [ready, ohmYear]);

  // Push filtered data through to the existing source rather than rebuilding
  // it, so filtering never disturbs the viewport.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
    source?.setData(toGeoJson(places, highlighted, selectedHandle));
  }, [places, highlighted, selectedHandle, ready]);

  // Fit to the requested places (see fitRequest). Skipped at fitRequest 0 so
  // the remembered viewport survives the first open.
  const fitPlaces = fitTo ?? places;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fitRequest === 0 || fitPlaces.length === 0) return;
    if (fitPlaces.length === 1) {
      map.easeTo({ center: [fitPlaces[0].long, fitPlaces[0].lat], zoom: Math.max(map.getZoom(), 9) });
      return;
    }
    const bounds = new maplibregl.LngLatBounds(
      [fitPlaces[0].long, fitPlaces[0].lat],
      [fitPlaces[0].long, fitPlaces[0].lat],
    );
    for (const place of fitPlaces) bounds.extend([place.long, place.lat]);
    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 600 });
  }, [fitRequest, ready, fitPlaces]);

  return (
    <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {tileError && (
        <Alert
          color="yellow"
          title={t("Map tiles unavailable")}
          m="md"
          style={{ position: "absolute", top: 0, left: 0, right: 60, zIndex: 2 }}
        >
          {t("The basemap comes from tiles.openfreemap.org and couldn't be reached. Your places are still plotted — they're read from this device's own cache — but there's no map under them.")}
        </Alert>
      )}
    </Box>
  );
}
