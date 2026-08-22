// No bundled types (see README/index.js) -- just the one function both map
// components actually call. See mapStyles.ts for why the named export is
// used directly rather than the plugin's own `map.filterByDate()` method.
declare module "@openhistoricalmap/maplibre-gl-dates" {
  import type { Map as MapLibreMap } from "maplibre-gl";

  export function filterByDate(map: MapLibreMap, date: Date | string): void;
}
