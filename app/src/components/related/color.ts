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
