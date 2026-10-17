// A live "layers" list for every image overlay, drawn region and line (a
// route, a GPS track) attached to the currently-plotted places -- lets someone with several overlapping
// historical-map overlays (see the plan) see them, jump the map to one,
// dim one independently of the others, and hide one from view, all without
// opening MapItemEditorDialog.tsx's full drawing editor.
//
// Opacity here is a view-time *override*, not an edit: an image or region's
// own opacity is only ever set/changed in that full editor, and is what
// renders on the map by default. This panel's slider (like its show/hide
// checkbox) only ever overrides what's *displayed*, for the rest of this
// session -- it never writes to anyone's KML file, so it can't collide with
// (or be collided into by) another edit the way a persisted opacity control
// once did here.
import { useEffect, useState } from "react";
import { Checkbox, Collapse, Group, Paper, ScrollArea, Slider, Stack, Text, UnstyledButton } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { formatDisplayDate } from "../../store/placeIndex";
import type { MapPlace } from "../../store/visualData";
import {
  fetchAllKmlImageOverlays, fetchAllKmlLines, fetchAllKmlRegions, type KmlImageOverlay, type KmlLine, type KmlRegion,
} from "../../store/kmlMedia";
import { overlayDateVisible } from "./mapStyles";
import { t } from "../../i18n/i18n";

type RowKind = "image" | "region" | "line";

/** A row's own identity, shared with MapCanvas.tsx so a checked-off or
 * opacity-overridden item there matches back to the exact overlay, region
 * or line this panel is showing a control for. */
function rowKey(kind: RowKind, kmlHandle: string, indexInFile: number): string {
  return `${kind}:${kmlHandle}:${indexInFile}`;
}

interface OverlayRow {
  kind: RowKind;
  kmlHandle: string;
  indexInFile: number;
  name?: string;
  /** This item's own saved opacity (from MapItemEditorDialog.tsx) -- what
   * the slider below shows/starts at absent an override for this row (see
   * `opacityOverrides`). Always 1 for a line, which has no saved opacity. */
  opacity: number;
  placeTitle: string;
  /** [west, south, east, north] -- the bounding box of an image's 4 corners,
   * or of a region's ring vertices (dropping GeoJSON's closing repeat of the
   * first point); either way, what a click here fits the map to. A bounding
   * box (rather than just a centroid) lets MapCanvas zoom *out* when the
   * overlay is bigger than the current view, not just ease sideways at
   * whatever zoom the map already happened to be at. */
  bounds: [number, number, number, number];
  /** Images only -- see KmlImageOverlay.order. Regions and lines have no
   * stacking concept of their own yet, so they simply list after every
   * image (regions, then lines), in whatever order they were fetched. */
  order: number;
}

function boundsOf(coords: [number, number][]): [number, number, number, number] {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function imageToRow(overlay: KmlImageOverlay, placeTitle: string): OverlayRow {
  return {
    kind: "image", kmlHandle: overlay.kmlHandle, indexInFile: overlay.indexInFile, name: overlay.name,
    opacity: overlay.opacity, placeTitle, bounds: boundsOf(overlay.corners), order: overlay.order,
  };
}

function regionToRow(region: KmlRegion, placeTitle: string): OverlayRow {
  // GeoJSON closes a ring by repeating its first point as its last --
  // dropped here so it isn't double-counted in the bounds.
  const verts = region.ring.slice(0, -1);
  return {
    kind: "region", kmlHandle: region.kmlHandle, indexInFile: region.indexInFile, name: region.name,
    opacity: region.opacity, placeTitle, bounds: boundsOf(verts), order: Infinity,
  };
}

function lineToRow(line: KmlLine, placeTitle: string): OverlayRow {
  return {
    kind: "line", kmlHandle: line.kmlHandle, indexInFile: line.indexInFile, name: line.name,
    opacity: 1, placeTitle, bounds: boundsOf(line.coords), order: Infinity,
  };
}

function untitled(kind: RowKind): string {
  if (kind === "image") return t("Untitled overlay");
  if (kind === "region") return t("Untitled region");
  return t("Untitled line");
}

interface OverlayLayersPanelProps {
  /** Same set MapView passes to MapCanvas -- the panel only ever lists
   * items actually visible (or hidden-by-date) on the map right now. */
  places: MapPlace[];
  ohmYear: number | null;
  /** Fired when a row is clicked, so MapView can fit the map to that item's
   * bounding box -- zooming out as readily as in, unlike a plain centroid
   * ease. */
  onFlyTo: (bounds: [number, number, number, number]) => void;
  /** Which rows (by rowKey) are checked off the map for the rest of this
   * session -- owned by MapView (not persisted anywhere; a plain view
   * preference, not an edit to anyone's file) so MapCanvas can see it too
   * and actually stop drawing them. */
  hiddenKeys: Set<string>;
  onToggleHidden: (key: string) => void;
  /** Which rows (by rowKey) have a view-time opacity override in place --
   * same "owned by MapView, not persisted" nature as `hiddenKeys`. A row
   * with no entry here shows its own saved opacity. */
  opacityOverrides: Map<string, number>;
  onOverrideOpacity: (key: string, opacity: number) => void;
}

export function OverlayLayersPanel({
  places, ohmYear, onFlyTo, hiddenKeys, onToggleHidden, opacityOverrides, onOverrideOpacity,
}: OverlayLayersPanelProps) {
  const kmlKey = [...new Set(places.flatMap((place) => place.kmlMedia))].sort().join(",");
  const [rows, setRows] = useState<OverlayRow[]>([]);
  // Expanded by default -- the panel only appears at all once a place with
  // an overlay is on screen, and selecting that place is already the
  // deliberate act; the controls it exists to offer shouldn't need a second
  // click to reveal.
  const [opened, setOpened] = useState(true);

  useEffect(() => {
    if (kmlKey === "") {
      setRows([]);
      return;
    }
    let cancelled = false;
    const handles = kmlKey.split(",");
    const placeByKmlHandle = new Map(
      places.flatMap((place) => place.kmlMedia.map((handle) => [handle, place] as const))
    );
    Promise.all([
      fetchAllKmlImageOverlays(handles), fetchAllKmlRegions(handles), fetchAllKmlLines(handles),
    ]).then(([overlays, regions, lines]) => {
      if (cancelled) return;
      const titleOf = (kmlHandle: string) => placeByKmlHandle.get(kmlHandle)?.title ?? "";
      const imageRows = overlays.map((o) => imageToRow(o, titleOf(o.kmlHandle)));
      const regionRows = regions.map((r) => regionToRow(r, titleOf(r.kmlHandle)));
      const lineRows = lines.map((l) => lineToRow(l, titleOf(l.kmlHandle)));
      imageRows.sort((a, b) => a.order - b.order);
      setRows([...imageRows, ...regionRows, ...lineRows]);
    });
    return () => {
      cancelled = true;
    };
    // `places` is read for its own kmlMedia/title only when this actually
    // refetches (kmlKey changing) -- not a dependency itself, same
    // reasoning as MapCanvas.tsx's identical exclusion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kmlKey]);

  function nameDateOf(row: OverlayRow): GrampsDate | undefined {
    return places.find((place) => place.kmlMedia.includes(row.kmlHandle))?.nameDate;
  }

  if (rows.length === 0) return null;

  return (
    <Paper withBorder shadow="md" p="xs" style={{ position: "absolute", right: 12, top: 12, width: 260, zIndex: 3 }}>
      <UnstyledButton onClick={() => setOpened((o) => !o)} style={{ display: "block", width: "100%" }}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" fw={600} c="dimmed">
            {t("Overlays")} {rows.length > 1 ? `(${rows.length})` : ""}
          </Text>
          <Text size="xs" c="dimmed">{opened ? "▾" : "▸"}</Text>
        </Group>
      </UnstyledButton>
      <Collapse in={opened}>
        <ScrollArea.Autosize mah={320} mt={8}>
          <Stack gap={10}>
            {rows.map((row) => {
              const key = rowKey(row.kind, row.kmlHandle, row.indexInFile);
              const nameDate = row.kind === "image" ? nameDateOf(row) : undefined;
              const visibleNow = overlayDateVisible(nameDate, ohmYear);
              const shown = !hiddenKeys.has(key);
              // The override if one's been set this session, otherwise the
              // item's own saved value -- see this component's own doc
              // comment on why there's no separate "reset" affordance:
              // dragging back never needs one, it just sets the override to
              // the same number the row already started at.
              const opacity = opacityOverrides.get(key) ?? row.opacity;
              return (
                <Stack key={key} gap={4}>
                  <Group gap={6} wrap="nowrap" align="flex-start">
                    <Checkbox
                      size="xs"
                      mt={2}
                      checked={shown}
                      onChange={() => onToggleHidden(key)}
                      aria-label={t("Show on map")}
                    />
                    <UnstyledButton
                      onClick={() => onFlyTo(row.bounds)}
                      title={t("Go to overlay")}
                      disabled={!shown}
                      style={{ flex: 1, minWidth: 0, textAlign: "left" }}
                    >
                      <Text size="xs" fw={500} truncate c={shown ? undefined : "dimmed"}>
                        {row.name || untitled(row.kind)}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {row.placeTitle}
                        {nameDate ? ` · ${formatDisplayDate(nameDate)}` : ""}
                        {!visibleNow ? ` (${t("hidden now")})` : ""}
                      </Text>
                    </UnstyledButton>
                  </Group>
                  <Slider
                    size="xs"
                    ml={26}
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={opacity}
                    label={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => onOverrideOpacity(key, v)}
                    disabled={!shown}
                  />
                </Stack>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      </Collapse>
    </Paper>
  );
}
