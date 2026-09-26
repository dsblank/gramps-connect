import { useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { downloadSvgAsPng } from "../../store/exportSvgImage";
import { t } from "../../i18n/i18n";

interface DownloadImageButtonProps {
  /** Called on click to get the *current* live SVG to export -- a callback
   * rather than a plain ref, since the chart wrapping this button rebuilds
   * a fresh `<svg>` on nearly every render (FanChart.tsx's own
   * container.replaceChildren), so a ref captured once would go stale. */
  getSvg: () => SVGSVGElement | null;
  /** Without an extension -- downloadSvgAsPng always saves a `.png`. */
  filename: string;
}

/** One button meant to work the same way for every chart this app draws
 * into an SVG (the fan chart today; a box/timeline chart can wire up the
 * same getSvg+filename pair later) -- "Download image", the same thing the
 * original Gramps desktop offers per-chart, rather than a browser
 * screenshot. */
export function DownloadImageButton({ getSvg, filename }: DownloadImageButtonProps) {
  const [downloading, setDownloading] = useState(false);

  async function handleClick() {
    const svg = getSvg();
    if (!svg) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(svg, `${filename}.png`);
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("Couldn't export the image"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Tooltip label={t("Download image")} withArrow>
      <ActionIcon variant="default" size="md" loading={downloading} onClick={handleClick} aria-label={t("Download image")}>
        ⭳
      </ActionIcon>
    </Tooltip>
  );
}
