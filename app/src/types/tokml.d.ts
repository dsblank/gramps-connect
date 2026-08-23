// No bundled types -- just the one function MapItemEditorDialog.tsx (via
// store/kmlWrite.ts) actually calls, mirroring
// openhistoricalmap-maplibre-gl-dates.d.ts's precedent for an untyped
// dependency in this codebase.
declare module "tokml" {
  import type { FeatureCollection } from "geojson";

  export default function tokml(geojson: FeatureCollection, options?: Record<string, unknown>): string;
}
