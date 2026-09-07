// A live "layers" list for every image overlay attached to the
// currently-plotted places -- lets someone with several overlapping
// historical-map overlays (see the plan) see them, jump the map to one, and
// dim them all at once without opening MapItemEditorDialog.tsx's full
// drawing editor. Each edit here goes through overlayEdit.ts's
// patchOverlaysInFile, which only ever rewrites the file(s) the edited
// overlays actually live in -- so adjusting opacity never touches a third
// overlay's file, wherever it lives.
import { useEffect, useState } from "react";
import { Collapse, Group, NavLink, Paper, ScrollArea, Slider, Stack, Text, UnstyledButton } from "@mantine/core";
import { formatDate, type GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../../auth/auth";
import type { MapPlace } from "../../store/visualData";
import { fetchAllKmlImageOverlays, type KmlImageOverlay } from "../../store/kmlMedia";
import { patchOverlaysInFile } from "../../store/overlayEdit";
import { overlayDateVisible } from "./mapStyles";
import { t } from "../../i18n/i18n";

interface OverlayRow extends KmlImageOverlay {
  placeTitle: string;
  /** This overlay's own position among only the other overlays living in
   * the same KML file -- what patchOverlaysInFile needs to address it there,
   * distinct from `order`'s rank among every overlay on the map. */
  indexInFile: number;
}

/** The rectangle's own center -- corners are maplibre's [lng, lat] order
 * (see OverlayCorners), so a plain average of each axis is correct even
 * though the shape can be a warped quadrilateral (move/resize/rotate all
 * transform the 4 points directly), not just an axis-aligned box. */
function overlayCentroid(row: OverlayRow): [number, number] {
  const lng = row.corners.reduce((sum, c) => sum + c[0], 0) / row.corners.length;
  const lat = row.corners.reduce((sum, c) => sum + c[1], 0) / row.corners.length;
  return [lng, lat];
}

interface OverlayLayersPanelProps {
  /** Same set MapView passes to MapCanvas -- the panel only ever lists
   * overlays actually visible (or hidden-by-date) on the map right now. */
  places: MapPlace[];
  ohmYear: number | null;
  /** Bumped so MapView can pass a fresh `overlayRefreshToken` to MapCanvas,
   * whose own KML cache-consuming effect otherwise has no way to notice a
   * content-only edit to a handle it already has (see MapCanvas.tsx's own
   * doc comment on that prop). */
  onChanged: () => void;
  /** Fired when a row is clicked, so MapView can ease the map to that
   * overlay's centroid the same way a search result or a scope does. */
  onFlyTo: (center: [number, number]) => void;
}

export function OverlayLayersPanel({ places, ohmYear, onChanged, onFlyTo }: OverlayLayersPanelProps) {
  const kmlKey = [...new Set(places.flatMap((place) => place.kmlMedia))].sort().join(",");
  const [rows, setRows] = useState<OverlayRow[]>([]);
  // Bumped after a successful patch to force a refetch below -- a patch
  // changes a KML file's *content*, not the set of handles `kmlKey` tracks,
  // so it wouldn't otherwise be noticed here either.
  const [reloadTick, setReloadTick] = useState(0);
  // The one opacity control for every overlay at once -- dragged locally
  // (so the slider itself feels live) and only patched into the KML file(s)
  // on release (see onChangeEnd below), the same as the old per-row slider
  // did: each patch is a full rewrite of the owning file plus a KML refetch,
  // not something to fire on every pixel of drag.
  const [masterOpacity, setMasterOpacity] = useState(1);
  // Collapsed by default -- the panel only appears at all once a place with
  // an overlay is on screen, and most of the time there's nothing to do
  // here beyond knowing overlays exist; opening it is a deliberate act.
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (kmlKey === "") {
      setRows([]);
      return;
    }
    let cancelled = false;
    const placeByKmlHandle = new Map(
      places.flatMap((place) => place.kmlMedia.map((handle) => [handle, place] as const))
    );
    fetchAllKmlImageOverlays(kmlKey.split(",")).then((overlays) => {
      if (cancelled) return;
      const seenPerHandle = new Map<string, number>();
      const withMeta = overlays.map((overlay) => {
        const indexInFile = seenPerHandle.get(overlay.kmlHandle) ?? 0;
        seenPerHandle.set(overlay.kmlHandle, indexInFile + 1);
        return {
          ...overlay,
          placeTitle: placeByKmlHandle.get(overlay.kmlHandle)?.title ?? "",
          indexInFile,
        };
      });
      withMeta.sort((a, b) => a.order - b.order);
      setRows(withMeta);
      if (withMeta.length > 0) {
        setMasterOpacity(withMeta.reduce((sum, r) => sum + r.opacity, 0) / withMeta.length);
      }
    });
    return () => {
      cancelled = true;
    };
    // `places` is read for its own kmlMedia/title only when this actually
    // refetches (kmlKey or reloadTick changing) -- not a dependency itself,
    // same reasoning as MapCanvas.tsx's identical exclusion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kmlKey, reloadTick]);

  function nameDateOf(row: OverlayRow): GrampsDate | undefined {
    return places.find((place) => place.kmlMedia.includes(row.kmlHandle))?.nameDate;
  }

  async function setOpacityAll(opacity: number) {
    const token = await getToken();
    // Grouped by file, one patchOverlaysInFile call per file -- two rows
    // that share a KML file (see indexInFile) must go through the same
    // fetch-then-write pass, or whichever finishes last would silently
    // revert the other (see that function's own doc comment). Different
    // files stay independent and patch in parallel.
    const byFile = new Map<string, Map<number, { opacity: number }>>();
    for (const row of rows) {
      if (!byFile.has(row.kmlHandle)) byFile.set(row.kmlHandle, new Map());
      byFile.get(row.kmlHandle)!.set(row.indexInFile, { opacity });
    }
    await Promise.all(
      [...byFile.entries()].map(([kmlHandle, patches]) => patchOverlaysInFile(token, kmlHandle, patches))
    );
    setReloadTick((n) => n + 1);
    onChanged();
  }

  if (rows.length === 0) return null;

  return (
    <Paper withBorder shadow="md" p="xs" style={{ position: "absolute", right: 12, top: 12, width: 260, zIndex: 3 }}>
      <UnstyledButton onClick={() => setOpened((o) => !o)} style={{ display: "block", width: "100%" }}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" fw={600} c="dimmed">
            {t("Overlay images")} {rows.length > 1 ? `(${rows.length})` : ""}
          </Text>
          <Text size="xs" c="dimmed">{opened ? "▾" : "▸"}</Text>
        </Group>
      </UnstyledButton>
      <Collapse in={opened}>
        <Stack gap={2} mb={8} mt={8}>
          <Text size="xs" c="dimmed">{t("Opacity")}</Text>
          <Slider
            size="xs"
            min={0.1}
            max={1}
            step={0.05}
            value={masterOpacity}
            label={(v) => `${Math.round(v * 100)}%`}
            onChange={setMasterOpacity}
            onChangeEnd={setOpacityAll}
          />
        </Stack>
        <ScrollArea.Autosize mah={260}>
          <Stack gap={0}>
            {rows.map((row) => {
              const nameDate = nameDateOf(row);
              const visibleNow = overlayDateVisible(nameDate, ohmYear);
              return (
                <NavLink
                  key={`${row.kmlHandle}-${row.indexInFile}`}
                  onClick={() => onFlyTo(overlayCentroid(row))}
                  title={t("Go to overlay")}
                  py={4}
                  label={<Text size="xs" fw={500} truncate>{row.name || t("Untitled overlay")}</Text>}
                  description={
                    <Text size="xs" c="dimmed" truncate>
                      {row.placeTitle}
                      {nameDate ? ` · ${formatDate(nameDate)}` : ""}
                      {!visibleNow ? ` (${t("hidden now")})` : ""}
                    </Text>
                  }
                />
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      </Collapse>
    </Paper>
  );
}
