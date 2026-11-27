// Gramps (via GTK's legacy color chooser) stores Tag.color as 16-bit-per-
// channel hex -- "#RRRRGGGGBBBB" (12 hex digits), not CSS's 8-bit
// "#RRGGBB" (6 digits) -- confirmed against live data: e.g. "#efb60c280c28"
// for a red "ToDo" tag. Used as a CSS color value as-is, that 12-digit
// string is simply invalid and renders as nothing (transparent/default),
// not the wrong color -- silent, easy to miss without comparing against
// the actual stored value.
export function gtkColorToCss(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const hex = color.replace(/^#/, "");
  if (hex.length === 12) {
    // High byte of each 16-bit channel.
    return `#${hex.slice(0, 2)}${hex.slice(4, 6)}${hex.slice(8, 10)}`;
  }
  return color;
}

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Near-black or white, whichever contrasts more with a `#rrggbb` fill, or
 * undefined for anything else (a named color, a CSS variable). Tag colors
 * are whatever an editor picked, so text drawn on them (tag badges, chart
 * wedges colored by tag) can't assume one fixed color stays readable. */
export function readableTextOn(fill: string | undefined): "#0b0b0b" | "#ffffff" | undefined {
  if (!fill || !/^#[0-9a-f]{6}$/i.test(fill)) return undefined;
  const l = relativeLuminance(fill);
  // Contrast against black (#0b0b0b ~ 0.0037) vs white (#ffffff = 1).
  return (l + 0.05) / (0.0037 + 0.05) >= 1.05 / (l + 0.05) ? "#0b0b0b" : "#ffffff";
}
