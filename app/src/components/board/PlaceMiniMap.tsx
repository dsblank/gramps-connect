// A small live map in the board's sidebar for the selected place: where it
// is, with a pin. Loaded lazily (maplibre-gl is the app's heaviest module).
import { useEffect, useRef } from "react";
import { useComputedColorScheme } from "@mantine/core";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyleUrl } from "../visuals/mapStyles";

export default function PlaceMiniMap({ lat, long }: { lat: number; long: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const dark = useComputedColorScheme("light") === "dark";

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: mapStyleUrl(dark, null),
      center: [long, lat],
      zoom: 9,
      // Two fingers or Ctrl+scroll to zoom, so scrolling the sidebar still scrolls.
      cooperativeGestures: true,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    markerRef.current = new maplibregl.Marker({ color: "#c0392b" }).setLngLat([long, lat]).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Created once; moved and restyled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.jumpTo({ center: [long, lat] });
    markerRef.current?.setLngLat([long, lat]);
  }, [lat, long]);

  useEffect(() => {
    mapRef.current?.setStyle(mapStyleUrl(dark, null));
  }, [dark]);

  return <div ref={ref} style={{ height: 180, borderRadius: 4, overflow: "hidden" }} />;
}
