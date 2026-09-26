import { clickDownloadLink } from "./downloadFile";

/** Every `var(--mantine-...)` custom property this app's chart SVGs
 * currently reference for fill/stroke/font-family. Baked as literal
 * resolved values into the exported copy's own `<style>` below -- an SVG
 * rendered through `<img src="blob:...">` (downloadSvgAsPng's own approach)
 * is parsed as its own standalone document, with no access to the host
 * page's CSS custom properties at all, so `var(--mantine-color-text)` would
 * otherwise resolve to nothing and the whole chart would render black.
 * Add a name here if a future chart's own SVG references a token not
 * already in this list. */
const MANTINE_TOKENS = [
  "--mantine-font-family",
  "--mantine-color-body",
  "--mantine-color-default-border",
  "--mantine-color-text",
  "--mantine-color-dimmed",
];

const EXPORT_SCALE = 2;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't load the chart as an image"));
    image.src = src;
  });
}

/** Serializes a live, on-screen chart SVG to a standalone PNG and hands it
 * to the browser to save -- the shared "chart -> image file" primitive so
 * any chart drawn this app's usual imperative-d3-into-an-SVG way (the fan
 * chart today; the box tree/others later) can offer a "Download image" the
 * same few lines DownloadImageButton.tsx does: grab its own live `<svg>`
 * and call this. PNG rather than raw SVG since that's what someone used to
 * the original Gramps desktop's own per-chart image export expects to be
 * able to just open or paste anywhere, without wondering whether whatever
 * they paste it into even renders SVG.
 *
 * `<img>`-then-`<canvas>` rather than a library (no svg-to-png dependency
 * this app doesn't already have) -- the one real gotcha is CSS custom
 * properties not crossing into that standalone image document, handled by
 * MANTINE_TOKENS above. */
export async function downloadSvgAsPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const width = svg.width.baseVal.value || svg.getBoundingClientRect().width;
  const height = svg.height.baseVal.value || svg.getBoundingClientRect().height;
  if (width <= 0 || height <= 0) throw new Error("Nothing to export yet");

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const bodyStyle = getComputedStyle(document.body);
  const tokenCss = MANTINE_TOKENS.map((name) => `${name}:${bodyStyle.getPropertyValue(name).trim() || "initial"}`).join(";");
  const backgroundColor = bodyStyle.getPropertyValue("--mantine-color-body").trim() || "#ffffff";
  const style = clone.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `svg{${tokenCss}}`;
  clone.insertBefore(style, clone.firstChild);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgUrl = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width * EXPORT_SCALE;
    canvas.height = height * EXPORT_SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't render images to a canvas");
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngBlob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) throw new Error("Couldn't render the chart to an image");
    const pngUrl = URL.createObjectURL(pngBlob);
    clickDownloadLink(pngUrl, filename);
    setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
