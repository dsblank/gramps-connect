import { useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { t } from "../../i18n/i18n";
import { ChartExportDialog } from "./ChartExportDialog";

interface DownloadImageButtonProps {
  /** Called to get the *current* live SVG to export -- a callback rather
   * than a plain ref, since the chart wrapping this button rebuilds a fresh
   * `<svg>` on nearly every render (FanChart.tsx's own
   * container.replaceChildren), so a ref captured once would go stale. */
  getSvg: () => SVGSVGElement | null;
  /** Without an extension -- the format chosen in the dialog supplies it. */
  filename: string;
}

/** One button meant to work the same way for every chart this app draws
 * into an SVG (the fan chart and the box tree today) -- opens
 * ChartExportDialog, the same "export this chart" the original Gramps
 * desktop offers per chart, rather than a browser screenshot. */
export function DownloadImageButton({ getSvg, filename }: DownloadImageButtonProps) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Tooltip label={t("Export image")} withArrow>
        <ActionIcon variant="default" size="md" onClick={() => setOpened(true)} aria-label={t("Export image")}>
          ⭳
        </ActionIcon>
      </Tooltip>
      <ChartExportDialog opened={opened} onClose={() => setOpened(false)} getSvg={getSvg} filename={filename} />
    </>
  );
}
