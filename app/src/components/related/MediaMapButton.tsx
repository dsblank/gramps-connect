import { Button, Group, Tooltip } from "@mantine/core";
import { formatHash } from "../../hash";
import { getBacklinks, type ObjectDetail } from "../../store/objectDetail";
import { isMapFileMime } from "../../store/mapFileMime";
import { t } from "../../i18n/i18n";

/** A map file's (KML/GeoJSON/GPX) own "see it on the map" button -- deliberately not
 * folded into VisualButtons.tsx, whose Map/Timeline/Tree buttons scope a
 * visual to a *subject* (a person's events, a place's descendants, ...) and
 * Media has none of its own to scope to. This means something else: jump to
 * the place this file is attached to, where MapPlace.kmlMedia (visualData.ts)
 * and MapCanvas's KML overlay take over -- MapView's own "arriving with a
 * place subject" effect selects that place automatically so the shape is
 * already drawn on arrival, not one more click away. */
export function MediaMapButton({ detail }: { detail: ObjectDetail }) {
  if (!isMapFileMime(detail.mime)) return null;
  const places = (getBacklinks(detail).place ?? []) as { handle: string; title?: string }[];
  if (places.length === 0) return null;
  return (
    <Group gap="xs" wrap="wrap">
      {places.map((place) => (
        <Tooltip key={place.handle} label={t("See this file's shape on the map")} withArrow>
          <Button
            component="a"
            href={formatHash({ viewKey: "map", subject: { type: "place", handle: place.handle } })}
            size="xs"
            variant="light"
          >
            {places.length > 1 ? `${t("Map")}: ${place.title || place.handle}` : t("Map")}
          </Button>
        </Tooltip>
      ))}
    </Group>
  );
}
