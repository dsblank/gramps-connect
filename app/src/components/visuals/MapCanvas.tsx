import { useEffect, useRef, useState } from "react";
// Namespace import: maplibre-gl v5 has no default export.
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, Point as GeoJsonPoint } from "geojson";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { Alert, Box, useComputedColorScheme } from "@mantine/core";
import type { MapPlace } from "../../store/visualData";
import {
  fetchAllKmlFeatures, fetchAllKmlImageOverlays, kmlBounds, kmlOverlayBounds, unionBounds,
} from "../../store/kmlMedia";
import { getToken } from "../../auth/auth";
import { fetchAuthedBlobUrl } from "../../store/authedFetch";
import { readVisualColors } from "./cssVar";
import { seriesColor } from "./eventCategories";
import "maplibre-gl/dist/maplibre-gl.css";
import { t } from "../../i18n/i18n";
import { applyOhmYear, crossfadeStyleSwap, mapStyleKey, mapStyleUrl, overlayDateVisible } from "./mapStyles";
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
// Must match the `clusterMaxZoom` passed to addSource(SOURCE, ...) below --
// read by the cluster click handler to recognise a cluster supercluster can
// never split apart (its leaves sit at the same, or near-identical, pixel
// position at every zoom, e.g. several places backfilled from one overlay's
// centroid). getClusterExpansionZoom() answers such a cluster with
// CLUSTER_MAX_ZOOM + 1 -- one past the last zoom the index actually built a
// tree for -- and naively easing there just strands the user past the point
// where clustering stops, looking at a single dot with no "N" badge and no
// visible way to tell the places apart.
const CLUSTER_MAX_ZOOM = 13;

// Every currently-plotted place's attached KML file(s) (see
// MapPlace.kmlMedia), overlaid underneath the place markers so a field
// boundary or a route doesn't hide the pin that opened it.
const KML_SOURCE = "kml-overlay";
const KML_FILL_LAYER = "kml-fill";
const KML_LINE_LAYER = "kml-line";
const KML_POINT_LAYER = "kml-points";
const KML_LABEL_LAYER = "kml-labels";
const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };
// Stable reference for a `hiddenOverlayKeys` prop that's undefined (every
// caller but MapView) -- avoids a fresh `new Set()` on every render tripping
// the effects below into re-running for no reason.
const EMPTY_HIDDEN_KEYS: Set<string> = new Set();
// Same reasoning, for an undefined `opacityOverrides` prop.
const EMPTY_OPACITY_OVERRIDES: Map<string, number> = new Map();

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
  /** Which places' KML attachment(s) (see MapPlace.kmlMedia) actually draw,
   * as vector shapes and image overlays alike -- the selected place itself
   * plus its direct enclosed children (MapView builds this from
   * VisualData.childPlaces), so opening a state or county shows its own
   * overlay alongside the ones directly inside it, not just its own.
   * Ordered selected-place-first: both overlay effects below preserve that
   * order rather than re-sorting, so a child's shape/image ends up stacked
   * above its parent's rather than in arbitrary handle order. Defaults to
   * empty -- no overlay -- when omitted. */
  overlayPlaces?: MapPlace[];
  onSelectPlace: (place: MapPlace | null) => void;
  /** Non-null switches the basemap to OpenHistoricalMap tiles filtered to
   * this year (see MapModeControl / mapStyles.ts); null is the plain
   * OpenFreeMap basemap, unfiltered. */
  ohmYear: number | null;
  /** Bumped by OverlayLayersPanel.tsx when a row is clicked, to fit the
   * map to that overlay's bounds -- a counter rather than a boolean (same
   * reasoning as fitRequest) so clicking the same overlay twice in a row
   * still fires. */
  flyToRequest?: number;
  /** The [west, south, east, north] bounds to fit to when `flyToRequest`
   * bumps. */
  flyToTarget?: [number, number, number, number] | null;
  /** OverlayLayersPanel.tsx's own unchecked rows (rowKey-keyed) -- a plain
   * view preference for this session, not persisted anywhere, that this
   * component honors by not drawing that image overlay/region at all.
   * Undefined/empty for every caller that never shows the panel. */
  hiddenOverlayKeys?: Set<string>;
  /** OverlayLayersPanel.tsx's own per-row opacity override (rowKey-keyed),
   * same "view preference, not a file edit" nature as hiddenOverlayKeys --
   * an image/region's own saved opacity (from MapItemEditorDialog.tsx) is
   * what renders whenever a row has no entry here. */
  opacityOverrides?: Map<string, number>;
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
  places, fitRequest, highlighted, fitTo, selectedHandle, overlayPlaces = [], onSelectPlace, ohmYear,
  flyToRequest, flyToTarget, hiddenOverlayKeys, opacityOverrides,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  // A second, click-driven popup (list-of-places, closeButton: true) rather
  // than reusing popupRef -- that one is a hover tooltip that's rebuilt and
  // torn down on every mousemove/mouseleave over POINT_LAYER, which would
  // fight with this one staying open after the pointer moves off the marker.
  const clusterPopupRef = useRef<maplibregl.Popup | null>(null);
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
  const hiddenOverlayKeysRef = useRef(hiddenOverlayKeys);
  hiddenOverlayKeysRef.current = hiddenOverlayKeys;
  const opacityOverridesRef = useRef(opacityOverrides);
  opacityOverridesRef.current = opacityOverrides;
  // layer id -> the owning place's name.date, this overlay's own rowKey
  // (see OverlayLayersPanel.tsx's own rowKey/hiddenOverlayKeys/
  // opacityOverrides), and its own saved opacity (what renders absent an
  // override) -- populated by the image-overlay effect below and read by
  // the lightweight ohmYear-only effect just after it -- see both for why
  // this is split into two effects.
  const overlayMetaRef = useRef<Map<string, { nameDate: GrampsDate | undefined; key: string; opacity: number }>>(new Map());

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
      const coordinates = (feature.geometry as GeoJsonPoint).coordinates as [number, number];
      const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
      if (!source) return;
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        if (zoom <= CLUSTER_MAX_ZOOM) {
          clusterPopupRef.current?.remove();
          map.easeTo({ center: coordinates, zoom });
          return;
        }
        // supercluster can never split this cluster apart (see
        // CLUSTER_MAX_ZOOM's doc comment) -- list its leaves in a popup
        // instead of easing to the dead zoom past clustering, where they'd
        // render as one unlabeled dot with no way to tell them apart.
        source.getClusterLeaves(clusterId, Infinity, 0).then((leaves) => {
          const stacked = leaves
            .map((leaf) => placesRef.current.find((p) => p.handle === leaf.properties?.handle))
            .filter((p): p is MapPlace => p != null);
          if (stacked.length === 0) return;
          map.easeTo({ center: coordinates, zoom: CLUSTER_MAX_ZOOM });
          if (stacked.length === 1) {
            onSelectRef.current(stacked[0]);
            return;
          }
          // Inline styles rather than a stylesheet class -- this popup has no
          // existing CSS to hook into (gramps-place-popup above is untouched
          // by any rule either; hover text relies entirely on maplibre's own
          // default popup styling, which has nothing to say about a list of
          // buttons).
          const list = document.createElement("div");
          list.style.display = "flex";
          list.style.flexDirection = "column";
          list.style.gap = "2px";
          for (const place of stacked) {
            const item = document.createElement("button");
            item.type = "button";
            item.textContent = place.title;
            item.style.cssText =
              "all: unset; cursor: pointer; padding: 2px 4px; border-radius: 4px; white-space: nowrap;";
            item.onmouseenter = () => { item.style.background = "var(--mantine-color-gray-2, #e9ecef)"; };
            item.onmouseleave = () => { item.style.background = "transparent"; };
            item.onclick = () => {
              onSelectRef.current(place);
              clusterPopupRef.current?.remove();
            };
            list.appendChild(item);
          }
          clusterPopupRef.current?.remove();
          clusterPopupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 12 })
            .setLngLat(coordinates)
            .setDOMContent(list)
            .addTo(map);
        }).catch(() => {});
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
      if (hits.length === 0) {
        onSelectRef.current(null);
        clusterPopupRef.current?.remove();
      }
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

    // Added before the places source/layers below, so its shapes render
    // underneath the markers rather than obscuring them.
    if (!map.getSource(KML_SOURCE)) {
      map.addSource(KML_SOURCE, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      // ["get", "color"]/["get", "opacity"] read the per-feature colour/
      // opacity MapItemEditorDialog.tsx writes on a region (see its own doc
      // comment); coalesced with the fixed defaults so a KML file saved
      // before either property existed keeps rendering exactly as it always
      // has. `hidden` is a synthetic property this component itself stamps
      // onto a region's feature before calling setData below (see the
      // shapes effect) -- not read back from the KML file at all, it's
      // OverlayLayersPanel.tsx's per-session show/hide checkbox forcing the
      // region to zero opacity regardless of its own saved value. Inlined
      // per layer (rather than a shared variable) so each paint object
      // keeps maplibre's own contextual expression typing.
      map.addLayer({
        id: KML_FILL_LAYER,
        type: "fill",
        source: KML_SOURCE,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": ["coalesce", ["get", "color"], markColor],
          "fill-opacity": ["case", ["boolean", ["get", "hidden"], false], 0, ["coalesce", ["get", "opacity"], 0.25]],
        },
      });
      map.addLayer({
        id: KML_LINE_LAYER,
        type: "line",
        source: KML_SOURCE,
        // Polygon outline and bare LineString (a route) share one style --
        // there's no second thing a line width/colour would need to say.
        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
        paint: {
          "line-color": ["coalesce", ["get", "color"], markColor],
          "line-width": 2,
          // `hidden` is only ever set on a Polygon (see the shapes effect
          // below) -- a bare LineString route never has it, so this only
          // ever suppresses a hidden region's own outline, never a route.
          "line-opacity": ["case", ["boolean", ["get", "hidden"], false], 0, 1],
        },
      });
      map.addLayer({
        id: KML_POINT_LAYER,
        type: "circle",
        source: KML_SOURCE,
        // A named point is a label (see KML_LABEL_LAYER just below), drawn
        // as text only -- excluded here so it doesn't also get a dot.
        filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "name"]]],
        paint: {
          "circle-radius": 5,
          "circle-color": ["coalesce", ["get", "color"], markColor],
          "circle-stroke-width": 1,
          "circle-stroke-color": colors.surface,
        },
      });
      // A label placed via MapItemEditorDialog.tsx's "Label" tool -- a
      // Point feature whose only purpose is its `name` text, so it's
      // rendered as text alone (no dot underneath to anchor against,
      // unlike LABEL_LAYER below which labels an already-drawn marker).
      map.addLayer({
        id: KML_LABEL_LAYER,
        type: "symbol",
        source: KML_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "name"]],
        layout: {
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
          // Offset right rather than centered on the point -- see
          // MapItemEditorDialog.tsx's own version of this layer for why.
          "text-anchor": "left",
          "text-offset": [0.6, 0],
        },
        paint: {
          "text-color": ["coalesce", ["get", "color"], colors.text],
          "text-halo-color": colors.surface,
          "text-halo-width": 1.5,
        },
      });
    }

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
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
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
    clusterPopupRef.current?.remove();
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

  // `overlayPlaces`' own KML attachment(s) (see MapPlace.kmlMedia), overlaid
  // via KML_SOURCE above -- gated on selection (a place, and its direct
  // children, only once it's opened), matching the image-overlay gating a
  // few lines down. Keyed on the deduplicated handles themselves rather than
  // on `overlayPlaces` directly, so fetchAllKmlFeatures's own per-handle
  // cache is reused whenever the same handles recur. `new Set` preserves
  // first-seen order (not sorted) so the selected place's own shape(s) stay
  // first in `handles` below and a child's paints on top of it, not the
  // other way around.
  const kmlKey = [...new Set(overlayPlaces.flatMap((place) => place.kmlMedia))].join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(KML_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    if (kmlKey === "") {
      source.setData(EMPTY_FEATURE_COLLECTION);
      return;
    }
    let cancelled = false;
    const handles = kmlKey.split(",");
    // Fetched per handle (not all handles at once) so a region's position
    // in its own file's own feature array is recoverable -- the same
    // indexInFile fetchAllKmlRegions computes for OverlayLayersPanel.tsx's
    // list, and so the same key its rowKey/hiddenOverlayKeys addresses this
    // region by (see the `hidden` property stamped on below).
    Promise.all(handles.map((handle) => fetchAllKmlFeatures([handle]))).then((collections) => {
      if (cancelled) return;
      const hidden = hiddenOverlayKeys ?? EMPTY_HIDDEN_KEYS;
      const overrides = opacityOverrides ?? EMPTY_OPACITY_OVERRIDES;
      const features: Feature[] = [];
      collections.forEach((handleFeatures, hIdx) => {
        const kmlHandle = handles[hIdx];
        handleFeatures.forEach((feature, indexInFile) => {
          if (feature.geometry?.type !== "Polygon") {
            features.push(feature);
            return;
          }
          const key = `region:${kmlHandle}:${indexInFile}`;
          // @tmcw/togeojson surfaces a KML ExtendedData value as a plain
          // string ("0.25"), not a number -- fill-opacity is a numeric
          // paint property, so passing that string straight through failed
          // its expression at render time and silently rendered as if
          // unset (fully opaque). Same coercion+range check kmlMedia.ts's
          // own fetchAllKmlRegions already does; undefined (not a bad
          // value) falls through to fill-opacity's own 0.25 default.
          const savedRaw = Number(feature.properties?.opacity);
          const saved = Number.isFinite(savedRaw) && savedRaw >= 0 && savedRaw <= 1 ? savedRaw : undefined;
          // An override replaces the region's own saved `opacity` outright
          // (rather than a separate paint-expression layer, the way
          // `hidden` needs -- fill-opacity already reads this same
          // property, so overriding it here is enough).
          const opacity = overrides.has(key) ? overrides.get(key) : saved;
          features.push({
            ...feature,
            properties: { ...feature.properties, opacity, hidden: hidden.has(key) },
          });
        });
      });
      source.setData({ type: "FeatureCollection", features });
    }).catch(() => {
      if (!cancelled) source.setData(EMPTY_FEATURE_COLLECTION);
    });
    return () => {
      cancelled = true;
    };
  }, [kmlKey, ready, hiddenOverlayKeys, opacityOverrides]);

  // Like the shapes above, image overlays are gated on selection: with the
  // whole tree (or a whole scope) on screen there could be dozens of them
  // stacked across unrelated places, cluttering a view that's supposed to
  // read as a plain map of markers -- so only `overlayPlaces` (the place
  // currently opened in the detail card, plus its direct children -- see
  // MapView's `selected`/`overlayPlaces`) show their own overlay(s), the
  // same places OverlayLayersPanel.tsx now restricts its list to. Order
  // preserved (not sorted) for the same stacking reason as `kmlKey` above.
  const overlayKmlKey = [...new Set(overlayPlaces.flatMap((place) => place.kmlMedia))].join(",");

  // handle (a KML media object, i.e. what a MapPlace.kmlMedia entry is) ->
  // that place's own name.date -- what gates an overlay parsed out of that
  // file's date visibility (overlayDateVisible, applied below). Multiple
  // places could in principle list the same KML handle (they can't today --
  // one KML is always attached to exactly one place -- but this stays a
  // plain last-write-wins map rather than assuming that).
  const nameDateByKmlHandle = new Map(
    overlayPlaces.flatMap((place) => place.kmlMedia.map((handle) => [handle, place.nameDate] as const))
  );

  // Image overlays (KML GroundOverlay -- see MapItemEditorDialog.tsx's own
  // doc comment on that feature) attached to the selected place (see
  // overlayKmlKey above). Not a geojson source like the shapes above:
  // maplibre has no "image" geometry type inside a geojson source, each
  // overlay needs its own `type: "image"` source + raster layer. Rebuilt
  // wholesale on every `overlayKmlKey` change (add-then-remove rather than a
  // finer diff) -- this only runs when the selected place's own KML
  // attachment(s) change, so it's not a hot path.
  // Sorted ascending before insertion -- primarily by each overlay's place's
  // position in `overlayKmlKey` (selected place first, its children after,
  // per `overlayPlaces`' own order), then by that place's own `order` for
  // ties -- before insertion: each addLayer(..., beforeId) call inserts its
  // layer immediately below `beforeId`, pushing whatever was already there
  // further down. So inserting the selected place's own overlay(s) first and
  // a child's after means the child ends up added last, landing closest to
  // (and so rendering just below) KML_FILL_LAYER, i.e. on top of its parent's
  // -- the same "smaller shape shouldn't hide under the bigger one" reasoning
  // the vector effect's own ordering above follows.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    const addedIds: string[] = [];
    // A handful of overlays at once, never an unbounded gallery -- worth
    // fetchAuthedBlobUrl()'s blob-URL indirection to keep the access
    // token out of the URL (discussion #4), unlike MediaThumbnail.tsx's
    // own many-at-once inline thumbnails. Each blob URL is revoked in this
    // effect's own cleanup below, once maplibre no longer needs it.
    const objectUrls: string[] = [];
    (async () => {
      const handles = overlayKmlKey === "" ? [] : overlayKmlKey.split(",");
      const overlays = handles.length === 0 ? [] : await fetchAllKmlImageOverlays(handles);
      if (cancelled || overlays.length === 0) return;
      const handlePosition = new Map(handles.map((handle, index) => [handle, index]));
      overlays.sort((a, b) => {
        const byPlace = (handlePosition.get(a.kmlHandle) ?? 0) - (handlePosition.get(b.kmlHandle) ?? 0);
        return byPlace !== 0 ? byPlace : a.order - b.order;
      });
      const token = await getToken();
      if (cancelled) return;
      const hidden = hiddenOverlayKeysRef.current ?? EMPTY_HIDDEN_KEYS;
      const overrides = opacityOverridesRef.current ?? EMPTY_OPACITY_OVERRIDES;
      for (const [i, overlay] of overlays.entries()) {
        const id = `${KML_SOURCE}-image-${i}`;
        if (map.getSource(id)) continue;
        const url = await fetchAuthedBlobUrl(`/api/media/${encodeURIComponent(overlay.imageHandle)}/file`, token);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrls.push(url);
        map.addSource(id, { type: "image", url, coordinates: overlay.corners });
        // Inserted below the KML shape layers (same "underneath the place
        // markers" reasoning as those) so a place pin sitting on top of an
        // old-map overlay stays clickable.
        map.addLayer({ id, type: "raster", source: id }, KML_FILL_LAYER);
        const nameDate = nameDateByKmlHandle.get(overlay.kmlHandle);
        // Matches OverlayLayersPanel.tsx's own rowKey exactly -- what its
        // show/hide checkbox and opacity-override slider are keyed by.
        const key = `image:${overlay.kmlHandle}:${overlay.indexInFile}`;
        map.setPaintProperty(id, "raster-opacity", overrides.get(key) ?? overlay.opacity);
        overlayMetaRef.current.set(id, { nameDate, key, opacity: overlay.opacity });
        const visible = overlayDateVisible(nameDate, ohmYearRef.current) && !hidden.has(key);
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        addedIds.push(id);
      }
    })();
    return () => {
      cancelled = true;
      for (const id of addedIds) {
        overlayMetaRef.current.delete(id);
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // nameDateByKmlHandle is derived fresh from `overlayPlaces` every render
    // -- deliberately not a dependency (it'd fire this whole rebuild on
    // every place-store tick); `overlayKmlKey` already captures every case
    // that changes which KML file (and so which overlays/dates) are in play.
    // hiddenOverlayKeys/opacityOverrides are read via their own refs above
    // (only for this *initial* mount) rather than listed here -- a later
    // change to either is handled live by the lightweight effect just below,
    // without tearing down and refetching every image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKmlKey, ready]);

  // Re-checks each already-added overlay's visibility/opacity against a new
  // `ohmYear`, `hiddenOverlayKeys`, or `opacityOverrides` alone -- plain
  // paint/layout-property toggles, not the rebuild above, so scrubbing the
  // historical-map year, clicking a row's checkbox, or dragging its opacity
  // slider never re-fetches a single image. overlayMetaRef is populated by
  // the effect above and outlives it (not cleared on this effect's own
  // re-run).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const hidden = hiddenOverlayKeys ?? EMPTY_HIDDEN_KEYS;
    const overrides = opacityOverrides ?? EMPTY_OPACITY_OVERRIDES;
    for (const [id, { nameDate, key, opacity }] of overlayMetaRef.current) {
      if (!map.getLayer(id)) continue;
      const visible = overlayDateVisible(nameDate, ohmYear) && !hidden.has(key);
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      map.setPaintProperty(id, "raster-opacity", overrides.get(key) ?? opacity);
    }
  }, [ohmYear, ready, hiddenOverlayKeys, opacityOverrides]);

  // Fit to the requested places (see fitRequest). Skipped at fitRequest 0 so
  // the remembered viewport survives the first open.
  //
  // Guarded against reapplying the same request: `ready` is a dependency
  // (a fit requested before the style has finished its first load has to
  // wait for it), but `ready` also flips false-then-true on every mode/
  // theme swap (crossfadeStyleSwap's setStyle() forces a reload) even
  // though `fitRequest` itself hasn't changed -- without this, switching
  // Standard/Historical after zooming in by hand (or after the KML-bounds
  // refinement below zoomed in further) would silently redo the last fit
  // and yank the viewport straight back to it. Found live.
  const fitPlaces = fitTo ?? places;
  const appliedFitRequestRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fitRequest === 0 || fitPlaces.length === 0) return;
    if (appliedFitRequestRef.current === fitRequest) return;
    appliedFitRequestRef.current = fitRequest;
    const single = fitPlaces.length === 1;
    if (single) {
      map.easeTo({ center: [fitPlaces[0].long, fitPlaces[0].lat], zoom: Math.max(map.getZoom(), 9) });
    } else {
      const bounds = new maplibregl.LngLatBounds(
        [fitPlaces[0].long, fitPlaces[0].lat],
        [fitPlaces[0].long, fitPlaces[0].lat],
      );
      for (const place of fitPlaces) bounds.extend([place.long, place.lat]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 600 });
    }

    // A KML attachment is typically a field boundary, a short route, or an
    // image overlay -- far tighter (or, for an overlay anchored off to one
    // side of its place, differently centered) than the flat point-fit just
    // done above, and there's no way to know how tight without the file's
    // own coordinates. There's one collective refinement across every
    // fitPlaces place's attachment(s), not just the subject's own -- a
    // context-mode fit (e.g. arriving on a State via its "Map" link) frames
    // that state plus whatever it encloses, and clipping the state's own
    // outline to just the point-bbox of its markers (as the multi-place
    // branch above does on its own) would defeat the entire reason someone
    // followed that link. Fetched from every place at once so a single
    // fitBounds call frames the union rather than one call per place
    // fighting over the last word.
    //
    // Deduplicated: two places sharing a KML attachment (or a place
    // appearing in `fitPlaces` more than once, which doesn't currently
    // happen but costs nothing to guard) would otherwise fetch/parse the
    // same file twice -- free either way since fetchAllKmlFeatures/
    // fetchAllKmlImageOverlays cache per handle, but there's no reason to
    // even ask twice.
    const kmlMedia = [...new Set(fitPlaces.flatMap((place) => place.kmlMedia))];
    if (kmlMedia.length === 0) return;
    let cancelled = false;
    Promise.all([fetchAllKmlFeatures(kmlMedia), fetchAllKmlImageOverlays(kmlMedia)])
      .then(([features, overlays]) => {
        if (cancelled) return;
        let bounds = unionBounds(kmlBounds(features), kmlOverlayBounds(overlays));
        // In the multi-place case, folded in with every plotted marker's own
        // point too -- an attachment shouldn't shrink the frame past a
        // marker that has no attachment of its own to contribute.
        if (!single) {
          for (const place of fitPlaces) {
            bounds = unionBounds(bounds, [place.long, place.lat, place.long, place.lat]);
          }
        }
        if (bounds) {
          map.fitBounds(
            [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
            { padding: single ? 0 : 60, maxZoom: single ? 17 : 12, duration: 600 },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fitRequest, ready, fitPlaces]);

  // Fit to an overlay's bounds on request (see flyToRequest). fitBounds
  // (not easeTo with a floor on the current zoom) so this zooms *out* just
  // as readily as in -- an easeTo that only ever raised the floor left a
  // click on a bigger overlay stuck at whatever (tighter) zoom the map was
  // already at. Same already-applied guard as the fit effect above, for the
  // same reason: `ready` flips false-then-true on a mode/theme swap without
  // the request itself changing, and refitting to the last click then would
  // fight whatever the user has since panned to.
  const appliedFlyToRequestRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyToRequest || !flyToTarget) return;
    if (appliedFlyToRequestRef.current === flyToRequest) return;
    appliedFlyToRequestRef.current = flyToRequest;
    const [west, south, east, north] = flyToTarget;
    map.fitBounds([[west, south], [east, north]], { padding: 60, maxZoom: 17, duration: 800 });
  }, [flyToRequest, flyToTarget, ready]);

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
