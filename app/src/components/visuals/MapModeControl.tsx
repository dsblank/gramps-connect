import { Group, NumberInput, SegmentedControl, Slider, Text } from "@mantine/core";
import type { PlayerStrings } from "@gramps-connect/story/player";
import type { MapMode } from "./mapStyles";
import { t } from "../../i18n/i18n";

/** The Auto/Standard/Historical picker, shared by the main Map view's
 * toolbar and the Story presentation's overlay bar. "Auto" shows what year
 * it resolved to (there's nothing to drag when the year comes from
 * context), "Historical" shows the slider the user drags themselves. */
export function MapModeControl({
  mode, onModeChange, autoYear, year, onYearChange, yearBounds, words,
}: {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  /** What "Auto" resolves to right now, or null when there's nothing to
   * derive a year from -- an unscoped map view, or a story slide with no
   * place. Standard's basemap is shown in that case, same as picking
   * "Standard" outright. */
  autoYear: number | null;
  /** The user's own pick -- live only while `mode === "historical"`. */
  year: number;
  onYearChange: (year: number) => void;
  yearBounds: [number, number];
  /** The story player's words for these, where a story brings its own
   * (StoryView.tsx); else the app's t(). */
  words?: Partial<PlayerStrings>;
}) {
  const say = {
    auto: words?.auto ?? t("Auto"),
    standard: words?.standard ?? t("Standard"),
    historical: words?.historical ?? t("Historical"),
    autoYear: words?.historicalMapYear ?? ((year: number) => `${t("Historical map")}, ${year}`),
    noDate: words?.noDateStandardMap ?? t("No date here — standard map"),
    year: words?.historicalYear ?? t("Historical map year"),
  };
  return (
    <Group gap="sm" wrap="nowrap">
      <SegmentedControl
        size="xs"
        value={mode}
        onChange={(value) => onModeChange(value as MapMode)}
        data={[
          { value: "auto", label: say.auto },
          { value: "standard", label: say.standard },
          { value: "historical", label: say.historical },
        ]}
      />
      {mode === "auto" && (
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {autoYear != null ? say.autoYear(autoYear) : say.noDate}
        </Text>
      )}
      {mode === "historical" && (
        <Group gap={6} wrap="nowrap" style={{ minWidth: 234 }}>
          <Slider
            size="xs"
            style={{ width: 150 }}
            min={yearBounds[0]}
            max={yearBounds[1]}
            value={year}
            onChange={onYearChange}
            label={(value) => String(value)}
            aria-label={say.year}
          />
          {/* NumberInput's built-in up/down stepper is the "move back/forward
              by one year" control; typing directly into it is the "land on a
              particular year" one -- the slider alone made both fiddly at
              anything more than a handful of pixels per year. */}
          <NumberInput
            size="xs"
            style={{ width: 78 }}
            min={yearBounds[0]}
            max={yearBounds[1]}
            step={1}
            allowDecimal={false}
            value={year}
            onChange={(value) => { if (typeof value === "number") onYearChange(Math.round(value)); }}
            aria-label={say.year}
          />
        </Group>
      )}
    </Group>
  );
}
