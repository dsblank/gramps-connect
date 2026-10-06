import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Button, Checkbox, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { t } from "../../i18n/i18n";
import {
  exportChart, rasterSize, SAFE_CANVAS_AREA, type ExportFormat, type ExportOptions,
} from "../../store/chartExport/exportChart";
import { layoutOnPage, PAPER_SIZES, type PaperOrientation, type PaperSize } from "../../store/chartExport/paperSizes";
import { contentGroupOf, exportTransformOf, measureExportFrame } from "../../store/chartExport/prepareSvg";

/** Last-used choices, shared by every chart -- a per-browser convenience
 * (someone who prints A3 PDFs keeps getting A3 PDFs), not anything that
 * needs to follow them across devices. */
const STORAGE_KEY = "gramps-connect_chart_export";

const DEFAULTS: ExportOptions = {
  format: "png",
  area: "whole",
  colors: "light",
  keepRotation: true,
  transparent: false,
  longEdgePx: 4000,
  paper: "A4",
  orientation: "auto",
  marginMm: 10,
};

function loadOptions(): ExportOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<ExportOptions>) : {};
    const merged = { ...DEFAULTS, ...saved };
    if (!(merged.paper in PAPER_SIZES)) merged.paper = DEFAULTS.paper;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

function saveOptions(options: ExportOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Private mode / blocked storage: just don't remember.
  }
}

interface ChartExportDialogProps {
  opened: boolean;
  onClose: () => void;
  /** The chart's *current* live `<svg>` -- see DownloadImageButton.tsx on
   * why a callback rather than a ref. */
  getSvg: () => SVGSVGElement | null;
  /** Without an extension -- the chosen format supplies it. */
  filename: string;
}

/** "Export image" for any chart that draws into an SVG -- format, area,
 * colors, and size/paper, the same choices the original Gramps desktop's
 * own chart export offers. Charts opt in to whole-chart export and the
 * rotation choice through prepareSvg.ts's data attributes; nothing here is
 * chart-specific. */
export function ChartExportDialog({ opened, onClose, getSvg, filename }: ChartExportDialogProps) {
  const [options, setOptions] = useState<ExportOptions>(loadOptions);
  const [exporting, setExporting] = useState(false);
  const [rasterizedNotice, setRasterizedNotice] = useState(false);
  // Read once per opening: what the chart supports doesn't change while
  // the (modal) dialog is up.
  const [capabilities, setCapabilities] = useState({ whole: true, rotation: false });
  const [frame, setFrame] = useState<DOMRect | null>(null);

  // Callers pass an inline arrow (a fresh function every parent render);
  // keying the effects below on it would re-run them -- and reset the
  // rasterized notice -- whenever the chart behind the dialog re-rendered.
  const getSvgRef = useRef(getSvg);
  getSvgRef.current = getSvg;

  const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!opened) return;
    setRasterizedNotice(false);
    const svg = getSvgRef.current();
    if (!svg) return;
    setCapabilities({ whole: contentGroupOf(svg) !== null, rotation: exportTransformOf(svg) !== "" });
  }, [opened]);

  const area = capabilities.whole ? options.area : "view";
  const keepRotation = area === "view" || (capabilities.rotation && options.keepRotation);

  useEffect(() => {
    if (!opened) return;
    const svg = getSvgRef.current();
    setFrame(svg ? measureExportFrame(svg, area, keepRotation) : null);
  }, [opened, area, keepRotation]);

  const sizeReadout = useMemo(() => {
    if (!frame) return null;
    if (options.format === "png" || options.format === "jpeg") {
      const { width, height } = rasterSize(frame.width, frame.height, options.longEdgePx);
      return {
        text: `${width.toLocaleString()} × ${height.toLocaleString()} px`,
        warn: width * height > SAFE_CANVAS_AREA,
      };
    }
    if (options.format === "pdf") {
      const page = layoutOnPage(frame.width, frame.height, options.paper, options.orientation, options.marginMm);
      const landscape = page.pageWidth > page.pageHeight;
      return {
        text: `${options.paper} ${landscape ? t("landscape") : t("portrait")} · ${t("chart")} ${Math.round(page.width)} × ${Math.round(page.height)} mm`,
        warn: false,
      };
    }
    return null;
  }, [frame, options]);

  async function handleExport() {
    const svg = getSvgRef.current();
    if (!svg) return;
    setExporting(true);
    try {
      const effective = { ...options, area, keepRotation };
      const result = await exportChart(svg, filename, effective);
      saveOptions(options);
      if (result.pdfRasterized) setRasterizedNotice(true);
      else onClose();
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("Couldn't export the image"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setExporting(false);
    }
  }

  const raster = options.format === "png" || options.format === "jpeg";

  return (
    <Modal opened={opened} onClose={onClose} title={t("Export image")}>
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          value={options.format}
          onChange={(v) => set("format", v as ExportFormat)}
          data={[
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPEG" },
            { value: "svg", label: "SVG" },
            { value: "pdf", label: "PDF" },
          ]}
        />

        {capabilities.whole && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>{t("Area")}</Text>
            <SegmentedControl
              value={options.area}
              onChange={(v) => set("area", v as ExportOptions["area"])}
              data={[
                { value: "whole", label: t("Whole chart") },
                { value: "view", label: t("Current view") },
              ]}
            />
          </Stack>
        )}

        <Stack gap={4}>
          <Text size="sm" fw={500}>{t("Colors")}</Text>
          <SegmentedControl
            value={options.colors}
            onChange={(v) => set("colors", v as ExportOptions["colors"])}
            data={[
              { value: "light", label: t("Light (for printing)") },
              { value: "current", label: t("As shown on screen") },
            ]}
          />
        </Stack>

        {capabilities.rotation && area === "whole" && (
          <Checkbox
            label={t("Keep the current rotation")}
            description={t("Unchecked exports the chart upright, whatever angle it's turned to on screen.")}
            checked={options.keepRotation}
            onChange={(e) => set("keepRotation", e.currentTarget.checked)}
          />
        )}

        {(options.format === "png" || options.format === "svg") && (
          <Checkbox
            label={t("Transparent background")}
            checked={options.transparent}
            onChange={(e) => set("transparent", e.currentTarget.checked)}
          />
        )}

        {raster && (
          <NumberInput
            label={t("Size of the longer side (pixels)")}
            min={500}
            max={16384}
            step={500}
            thousandSeparator=","
            value={options.longEdgePx}
            onChange={(v) => set("longEdgePx", typeof v === "number" ? v : DEFAULTS.longEdgePx)}
          />
        )}

        {options.format === "pdf" && (
          <Group grow align="flex-start">
            <Select
              label={t("Paper")}
              allowDeselect={false}
              value={options.paper}
              onChange={(v) => v && set("paper", v as PaperSize)}
              data={Object.keys(PAPER_SIZES)}
            />
            <Select
              label={t("Orientation")}
              allowDeselect={false}
              value={options.orientation}
              onChange={(v) => v && set("orientation", v as PaperOrientation)}
              data={[
                { value: "auto", label: t("Automatic") },
                { value: "portrait", label: t("Portrait") },
                { value: "landscape", label: t("Landscape") },
              ]}
            />
            <NumberInput
              label={t("Margin (mm)")}
              min={0}
              max={50}
              value={options.marginMm}
              onChange={(v) => set("marginMm", typeof v === "number" ? v : DEFAULTS.marginMm)}
            />
          </Group>
        )}

        {sizeReadout && (
          <Text size="xs" c={sizeReadout.warn ? "orange" : "dimmed"}>
            {sizeReadout.text}
            {sizeReadout.warn && ` — ${t("larger than some browsers (Safari) can render; reduce the size if the export fails.")}`}
          </Text>
        )}
        {options.format === "svg" && (
          <Text size="xs" c="dimmed">{t("SVG stays sharp at any size and opens in browsers and drawing programs.")}</Text>
        )}

        {rasterizedNotice && (
          <Alert color="yellow">
            {t(
              "Saved. This chart has names in a script the PDF's built-in font doesn't cover, so the PDF contains a high-resolution picture of the chart rather than selectable text.",
            )}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {rasterizedNotice ? t("Close") : t("Cancel")}
          </Button>
          <Button onClick={handleExport} loading={exporting} disabled={!frame}>
            {t("Export")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
