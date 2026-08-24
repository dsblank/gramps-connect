// Pilot: the full-bleed map behind a located story's slides -- flies to the
// current slide's point and freezes (camera stays put, marker fades) on a
// slide with none. Its own small maplibre instance, not a reuse of
// visuals/MapCanvas.tsx: that component is built around clustering an
// entire tree's places and doesn't expose the Map instance for imperative
// flyTo, which is all this needs. Grew out of a corner-inset version of the
// same code (see StoryView.tsx's git history) once the layout moved to a
// full-bleed background; the callback-ref-for-the-container pattern below
// is load-bearing -- see the comment on it -- not incidental.
import { useEffect, useRef, useState } from "react";
// Namespace import: maplibre-gl v5 has no default export.
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { Box } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { API_BASE } from "../../config";
import { readVisualColors } from "../visuals/cssVar";
import { seriesColor } from "../visuals/eventCategories";
import { applyOhmYear, crossfadeStyleSwap, mapStyleKey, mapStyleUrl } from "../visuals/mapStyles";
import { PIN_PATH_D } from "./storyMarker";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

// The current slide's place's KML attachment(s) (see MapPlace.kmlMedia /
// MapCanvas.tsx's own version of this), overlaid underneath the pin.
const KML_SOURCE = "story-kml-overlay";
const KML_FILL_LAYER = "story-kml-fill";
const KML_LINE_LAYER = "story-kml-line";
const KML_POINT_LAYER = "story-kml-points";
const KML_LABEL_LAYER = "story-kml-labels";
const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

export function StoryMapBackground({ initialCenter, currentPoint, dark, opened, panelFraction, ohmYear }: {
  initialCenter: [number, number];
  currentPoint: { lat: number; long: number; kmlMedia: string[] } | undefined;
  dark: boolean;
  opened: boolean;
  /** How much of the container's right side the content panel covers (see
   * StoryView.tsx's PANEL_FRACTION) -- what a point is centered against is
   * the *remaining* left-hand fraction, not a fixed half. */
  panelFraction: number;
  /** Non-null switches the basemap to OHM tiles filtered to this year (see
   * mapStyles.ts); null is the plain OpenFreeMap basemap. */
  ohmYear: number | null;
}) {
  // A callback ref (via state), not a plain useRef: Mantine's Modal doesn't
  // guarantee its children are in the DOM on the very first render pass
  // after `opened` flips true (its enter transition appears to mount
  // content a tick later), so a plain ref could still read null on the one
  // render the create-effect below was watching for -- and with nothing to
  // bump its dependency array afterward, the effect would never get a
  // second try. Tracking the node in state instead means the effect
  // re-runs the moment it actually shows up. (Found live: the map
  // intermittently failed to appear until this was in place.)
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  // Mirrors MapCanvas.tsx's own `ready`: flips true on "style.load", which
  // fires on initial load and again after every setStyle() -- the moment
  // the OHM filter effect below is safe to (re-)apply.
  const [ready, setReady] = useState(false);

  const darkRef = useRef(dark);
  darkRef.current = dark;
  const ohmYearRef = useRef(ohmYear);
  ohmYearRef.current = ohmYear;
  // What the live map was actually built (or last swapped) with -- lets the
  // style-swap effect below tell "the style actually needs to change" from
  // "this is just the effect's own mount", the same distinction
  // MapCanvas.tsx's own appliedStyleKeyRef makes, and for the same reason:
  // useComputedColorScheme returns a default on the first render and only
  // corrects itself a tick later -- recreating the whole map on that
  // correction (instead of swapping its style in place) meant a real map
  // could be destroyed and rebuilt moments after creation, sometimes
  // mid-load.
  const appliedStyleKeyRef = useRef(mapStyleKey(dark, ohmYear));

  useEffect(() => {
    if (!opened || !containerEl) return;
    setReady(false);
    appliedStyleKeyRef.current = mapStyleKey(darkRef.current, ohmYearRef.current);
    const map = new maplibregl.Map({
      container: containerEl,
      style: mapStyleUrl(darkRef.current, ohmYearRef.current),
      zoom: 5,
      attributionControl: { compact: true },
      // So crossfadeStyleSwap's canvas.toDataURL() snapshot reliably has the
      // last-rendered frame in it rather than a possibly-cleared buffer.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.on("style.load", () => setReady(true));
    // The right half of the container sits under the (opaque, by the time
    // the fade finishes) content panel, so the visible map is really just
    // the left half -- padding tells maplibre to center any given point
    // within the *unpadded* remainder rather than the container as a
    // whole, which is what puts a point at the left half's own midpoint
    // (1/4 of the full width) instead of the container's midpoint (1/2,
    // half-hidden behind the panel). Set before the first jump/flyTo so
    // even the opening frame is already correctly centered.
    map.setPadding({ top: 0, bottom: 0, left: 0, right: containerEl.clientWidth * panelFraction });
    map.jumpTo({ center: initialCenter });
    map.on("load", () => {
      const colors = readVisualColors();
      const el = document.createElement("div");
      el.style.width = "26px";
      el.style.height = "26px";
      el.style.transition = "opacity 300ms";
      el.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26">`
        + `<path d="${PIN_PATH_D}" fill="${seriesColor(darkRef.current)}" stroke="${colors.surface}" stroke-width="1.5" />`
        + `</svg>`;
      // "bottom" anchor, not the default "center" -- the pin's own tip
      // (PIN_PATH_D's point, at the bottom of its 24x24 box) is what should
      // land on the coordinate, not the shape's geometric centre.
      markerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(initialCenter).addTo(map);
    });
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // initialCenter deliberately excluded -- it's only the first frame,
    // re-centering on every point change is the flyTo effect's job below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, containerEl]);

  // Keyed by mapStyleKey, not `dark`/`ohmYear` directly -- see MapCanvas.tsx's
  // own version of this effect for why (OHM has no dark variant, and a
  // same-mode year change is the filter effect's job below, not a reload).
  useEffect(() => {
    const map = mapRef.current;
    const key = mapStyleKey(dark, ohmYear);
    if (!map || appliedStyleKeyRef.current === key) return;
    appliedStyleKeyRef.current = key;
    crossfadeStyleSwap(map, mapStyleUrl(dark, ohmYear), () => setReady(false));
  }, [dark, ohmYear]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || ohmYear == null) return;
    applyOhmYear(map, ohmYear);
  }, [ready, ohmYear]);

  // Adds (or re-adds) the KML overlay source/layers -- same shapes as
  // MapCanvas.tsx's own version, under the marker for the same reason. Runs
  // whenever `ready` flips true, since setStyle() (the crossfade swap above)
  // wipes every user-added source/layer along with the basemap it's
  // replacing, same as MapCanvas.tsx's places source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || map.getSource(KML_SOURCE)) return;
    const markColor = seriesColor(darkRef.current);
    const colors = readVisualColors();
    map.addSource(KML_SOURCE, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
    // See MapCanvas.tsx's own version of this coalesce for why: reads the
    // per-feature colour MapItemEditorDialog.tsx writes, falling back to
    // the fixed markColor for a KML file saved before that existed.
    map.addLayer({
      id: KML_FILL_LAYER,
      type: "fill",
      source: KML_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": ["coalesce", ["get", "color"], markColor], "fill-opacity": 0.25 },
    });
    map.addLayer({
      id: KML_LINE_LAYER,
      type: "line",
      source: KML_SOURCE,
      filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
      paint: { "line-color": ["coalesce", ["get", "color"], markColor], "line-width": 2 },
    });
    map.addLayer({
      id: KML_POINT_LAYER,
      type: "circle",
      source: KML_SOURCE,
      // See MapCanvas.tsx's own version of this filter: a named point is a
      // label (KML_LABEL_LAYER just below), drawn as text only.
      filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "name"]]],
      paint: {
        "circle-radius": 5,
        "circle-color": ["coalesce", ["get", "color"], markColor],
        "circle-stroke-width": 1,
        "circle-stroke-color": colors.surface,
      },
    });
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
  }, [ready]);

  // The current slide's place's KML attachment(s), fetched and drawn
  // whenever the slide changes -- see MapCanvas.tsx's own version of this
  // for the caching/dedup story (fetchAllKmlFeatures shares its per-handle
  // cache with every other reader). Dynamically imported: kmlMedia.ts pulls
  // in @tmcw/togeojson, and this component (unlike MapCanvas.tsx, which is
  // lazy-loaded from MapView) is part of the main bundle -- a story with no
  // KML-attached place should never pay for that parser.
  //
  // Once the shape is in, the camera refines to frame it -- a KML file is
  // typically a field boundary or a short route, far tighter than the flat
  // zoom 9 the flyTo effect below picks for an ordinary located point, and
  // there's no way to know how tight without the file's own coordinates. A
  // second camera move right after the first (that effect's flyTo already
  // got the map to roughly the right place) rather than replacing it: the
  // fetch is asynchronous and the plain point case still needs its own
  // immediate zoom.
  //
  // The fit itself is guarded to once per distinct `kmlKey` (via the ref
  // below), separately from the data refresh: `ready` is a dependency (the
  // source this writes into is wiped by every setStyle(), so its data has
  // to be re-supplied after each one), but `ready` also flips false-then-
  // true on every mode/theme swap even when the slide hasn't changed --
  // without the guard, switching Standard/Historical would redo the fit and
  // yank the viewport back from wherever the viewer had since zoomed or
  // panned to. Found live.
  const kmlKey = (currentPoint?.kmlMedia ?? []).join(",");
  const appliedKmlFitKeyRef = useRef<string | null>(null);
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
    import("../../store/kmlMedia")
      .then(async ({ fetchAllKmlFeatures, kmlBounds }) => {
        const features = await fetchAllKmlFeatures(kmlKey.split(","));
        return { features, bounds: kmlBounds(features) };
      })
      .then(({ features, bounds }) => {
        if (cancelled) return;
        source.setData({ type: "FeatureCollection", features });
        if (bounds && appliedKmlFitKeyRef.current !== kmlKey) {
          appliedKmlFitKeyRef.current = kmlKey;
          map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { maxZoom: 17, duration: 900 });
        }
      })
      .catch(() => {
        if (!cancelled) source.setData(EMPTY_FEATURE_COLLECTION);
      });
    return () => {
      cancelled = true;
    };
  }, [kmlKey, ready]);

  // Image overlays (KML GroundOverlay) on the current slide's place -- see
  // MapCanvas.tsx's own version of this effect for the full reasoning
  // (a maplibre geojson source can't hold an image, so each overlay gets
  // its own `type: "image"` source + raster layer, rebuilt wholesale
  // whenever the KML attachment set changes).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    const addedIds: string[] = [];
    (async () => {
      if (kmlKey === "") return;
      const { fetchAllKmlImageOverlays, rotatedOverlayCorners } = await import("../../store/kmlMedia");
      const overlays = await fetchAllKmlImageOverlays(kmlKey.split(","));
      if (cancelled || overlays.length === 0) return;
      const token = await getToken();
      if (cancelled) return;
      overlays.forEach((overlay, i) => {
        const id = `${KML_SOURCE}-image-${i}`;
        if (map.getSource(id)) return;
        const url = `${API_BASE}/api/media/${encodeURIComponent(overlay.imageHandle)}/file?jwt=${encodeURIComponent(token)}`;
        map.addSource(id, { type: "image", url, coordinates: rotatedOverlayCorners(overlay) });
        map.addLayer({ id, type: "raster", source: id }, KML_FILL_LAYER);
        addedIds.push(id);
      });
    })();
    return () => {
      cancelled = true;
      for (const id of addedIds) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    };
  }, [kmlKey, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (currentPoint) {
      map.flyTo({ center: [currentPoint.long, currentPoint.lat], zoom: 9, essential: true, duration: 900 });
      marker.setLngLat([currentPoint.long, currentPoint.lat]);
      marker.getElement().style.opacity = "1";
    } else {
      // No location on this slide: camera stays put, marker fades rather
      // than vanishing -- it can't hide entirely the way a corner inset
      // could, since the map is now always the visible background.
      marker.getElement().style.opacity = "0.4";
    }
  }, [currentPoint]);

  return <Box ref={setContainerEl} style={{ position: "absolute", inset: 0 }} />;
}
