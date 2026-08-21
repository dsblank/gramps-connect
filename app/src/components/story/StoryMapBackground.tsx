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
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Box } from "@mantine/core";
import { readVisualColors } from "../visuals/cssVar";
import { seriesColor } from "../visuals/eventCategories";
import { PIN_PATH_D } from "./storyMarker";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

export function StoryMapBackground({ initialCenter, currentPoint, dark, opened, panelFraction }: {
  initialCenter: [number, number];
  currentPoint: { lat: number; long: number } | undefined;
  dark: boolean;
  opened: boolean;
  /** How much of the container's right side the content panel covers (see
   * StoryView.tsx's PANEL_FRACTION) -- what a point is centered against is
   * the *remaining* left-hand fraction, not a fixed half. */
  panelFraction: number;
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

  const darkRef = useRef(dark);
  darkRef.current = dark;
  // What the live map was actually built (or last swapped) with -- lets the
  // style-swap effect below tell "dark really changed" from "this is just
  // the effect's own mount", the same distinction MapCanvas.tsx's own
  // appliedDarkRef makes. Needed because useComputedColorScheme returns a
  // default on the first render and only corrects itself a tick later --
  // recreating the whole map on that correction (instead of swapping its
  // style in place) meant a real map could be destroyed and rebuilt
  // moments after creation, sometimes mid-load.
  const appliedDarkRef = useRef(dark);

  useEffect(() => {
    if (!opened || !containerEl) return;
    appliedDarkRef.current = darkRef.current;
    const map = new maplibregl.Map({
      container: containerEl,
      style: darkRef.current ? STYLE_DARK : STYLE_LIGHT,
      zoom: 5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedDarkRef.current === dark) return;
    appliedDarkRef.current = dark;
    map.setStyle(dark ? STYLE_DARK : STYLE_LIGHT);
  }, [dark]);

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
