import { useSyncExternalStore, type ClipboardEvent } from "react";
import { TextInput } from "@mantine/core";
import { parseCoordinate, splitCoordinatePair } from "../store/placeCoords";
import { getI18nSnapshot, subscribe as subscribeI18n, t } from "../i18n/i18n";

const FORMAT_HINT = {
  lat: "e.g. 42.6986, 42° 41′ 55″ N or 42:41:55",
  long: "e.g. -2.8956, 2° 53′ 44″ W or -2:53:44",
};

/** "= 42.698611° N": the value as the map will read it. The English
 * letter, not the sign alone, is the point -- a German "O" previews as
 * "E" and a French one as "W", so a letter typed in the wrong language
 * shows up here rather than as a pin on the wrong side of Greenwich. */
function preview(value: number, kind: "lat" | "long"): string {
  const letter = kind === "lat" ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");
  return `= ${Math.abs(value).toFixed(6)}° ${letter}`;
}

interface CoordinateFieldsProps {
  lat: string;
  long: string;
  onChange: (patch: { lat?: string; long?: string }) => void;
}

/** A Place's Latitude and Longitude boxes, checked as you type with the
 * same parser the map uses (placeCoords.ts, in the interface language):
 * a decimal preview under a readable value, a red message under one the
 * map can't read. Like Gramps desktop, a bad value still saves -- blocking
 * would also stop fixing some other field on a place whose coordinates
 * came in broken from an import. Pasting a "lat, long" pair into either
 * box fills in both. Shared by ObjectEditDialog.tsx and PlaceEditDialog.tsx. */
export function CoordinateFields({ lat, long, onChange }: CoordinateFieldsProps) {
  const { lang } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pair = splitCoordinatePair(e.clipboardData.getData("text"), lang);
    if (!pair) return;
    e.preventDefault();
    onChange(pair);
  }

  function field(kind: "lat" | "long", value: string, other: string) {
    const label = kind === "lat" ? t("Latitude") : t("Longitude");
    let description: string | undefined;
    let error: string | undefined;
    if (value.trim()) {
      const parsed = parseCoordinate(value, kind, lang);
      if (parsed == null) {
        error = `Not a ${kind === "lat" ? "latitude" : "longitude"} Gramps can read (${FORMAT_HINT[kind]})`;
      } else {
        description = preview(parsed, kind);
      }
    } else if (other.trim()) {
      description = "Needed too for this place to appear on the map";
    }
    return (
      <TextInput
        label={label}
        value={value}
        description={description}
        error={error}
        inputWrapperOrder={["label", "input", "description", "error"]}
        onChange={(e) => onChange({ [kind]: e.currentTarget.value })}
        onPaste={onPaste}
      />
    );
  }

  return (
    <>
      {field("lat", lat, long)}
      {field("long", long, lat)}
    </>
  );
}
