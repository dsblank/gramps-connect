// A live "layers" list for every image overlay attached to the
// currently-plotted places -- lets someone with several overlapping
// historical-map overlays (see the plan) manage their stacking order and
// transparency without opening MapItemEditorDialog.tsx's full drawing
// editor. Each edit here goes through overlayEdit.ts's patchOverlayInFile,
// which only ever rewrites the one KML file an overlay actually lives in --
// so adjusting one overlay's opacity or swapping two overlays' stacking
// order never touches a third overlay's file, wherever it lives.
import { useEffect, useState } from "react";
import { ActionIcon, Group, Paper, ScrollArea, Slider, Stack, Text } from "@mantine/core";
import { formatDate, type GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../../auth/auth";
import type { MapPlace } from "../../store/visualData";
import { fetchAllKmlImageOverlays, type KmlImageOverlay } from "../../store/kmlMedia";
import { patchOverlayInFile } from "../../store/overlayEdit";
import { overlayDateVisible } from "./mapStyles";
import { t } from "../../i18n/i18n";

interface OverlayRow extends KmlImageOverlay {
  placeTitle: string;
  /** This overlay's own position among only the other overlays living in
   * the same KML file -- what patchOverlayInFile needs to address it there,
   * distinct from `order`'s rank among every overlay on the map. */
  indexInFile: number;
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
}

export function OverlayLayersPanel({ places, ohmYear, onChanged }: OverlayLayersPanelProps) {
  const kmlKey = [...new Set(places.flatMap((place) => place.kmlMedia))].sort().join(",");
  const [rows, setRows] = useState<OverlayRow[]>([]);
  // Bumped after a successful patch to force a refetch below -- a patch
  // changes a KML file's *content*, not the set of handles `kmlKey` tracks,
  // so it wouldn't otherwise be noticed here either.
  const [reloadTick, setReloadTick] = useState(0);

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

  async function setOpacity(row: OverlayRow, opacity: number) {
    const token = await getToken();
    await patchOverlayInFile(token, row.kmlHandle, row.indexInFile, { opacity });
    setReloadTick((n) => n + 1);
    onChanged();
  }

  async function swap(i: number, j: number) {
    if (j < 0 || j >= rows.length) return;
    const a = rows[i];
    const b = rows[j];
    const token = await getToken();
    await Promise.all([
      patchOverlayInFile(token, a.kmlHandle, a.indexInFile, { order: b.order }),
      patchOverlayInFile(token, b.kmlHandle, b.indexInFile, { order: a.order }),
    ]);
    setReloadTick((n) => n + 1);
    onChanged();
  }

  if (rows.length === 0) return null;

  return (
    <Paper withBorder shadow="md" p="xs" style={{ position: "absolute", right: 12, top: 12, width: 260, zIndex: 3 }}>
      <Text size="xs" fw={600} c="dimmed" mb={4}>{t("Overlays")}</Text>
      <ScrollArea.Autosize mah={260}>
        <Stack gap={8}>
          {rows.map((row, i) => {
            const nameDate = nameDateOf(row);
            const visibleNow = overlayDateVisible(nameDate, ohmYear);
            return (
              <Group key={`${row.kmlHandle}-${row.indexInFile}`} gap={6} wrap="nowrap" align="flex-start">
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="xs" fw={500} truncate>{row.name || t("Untitled overlay")}</Text>
                  <Text size="xs" c="dimmed" truncate>
                    {row.placeTitle}
                    {nameDate ? ` · ${formatDate(nameDate)}` : ""}
                    {!visibleNow ? ` (${t("hidden now")})` : ""}
                  </Text>
                  <Slider
                    size="xs"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={row.opacity}
                    label={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setRows((prev) => prev.map((r) => (r === row ? { ...r, opacity: v } : r)))}
                    onChangeEnd={(v) => setOpacity(row, v)}
                  />
                </Stack>
                <Stack gap={2}>
                  <ActionIcon
                    size="sm" variant="subtle" disabled={i === rows.length - 1}
                    onClick={() => swap(i, i + 1)} aria-label={t("Bring forward")} title={t("Bring forward")}
                  >
                    ▲
                  </ActionIcon>
                  <ActionIcon
                    size="sm" variant="subtle" disabled={i === 0}
                    onClick={() => swap(i, i - 1)} aria-label={t("Send backward")} title={t("Send backward")}
                  >
                    ▼
                  </ActionIcon>
                </Stack>
              </Group>
            );
          })}
        </Stack>
      </ScrollArea.Autosize>
    </Paper>
  );
}
